use cap_project::{
    AudioMeta, Cursors, MultipleSegment, MultipleSegments, Platform, RecordingMeta,
    RecordingMetaInner, StudioRecordingMeta, StudioRecordingStatus, VideoMeta,
};
use relative_path::RelativePathBuf;
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_specta::Event;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
    sync::watch,
};

pub(crate) mod projects;

#[derive(Default)]
pub struct CaptureStartGate(pub tokio::sync::Mutex<()>);

#[derive(Clone, Copy, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum MobilePlatform {
    Android,
    Ios,
}

#[derive(Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MobileDevice {
    pub id: String,
    pub name: String,
    pub platform: MobilePlatform,
    pub authorized: bool,
    pub audio_supported: bool,
    pub mi6_compatibility: bool,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MobileSetup {
    pub devices: Vec<MobileDevice>,
    pub android_ready: bool,
    pub ios_ready: bool,
    pub warnings: Vec<String>,
}

#[derive(Clone, Default, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum MobilePhase {
    #[default]
    Idle,
    Starting,
    Recording,
    Finalizing,
    Complete,
    Failed,
}

#[derive(Clone, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MobileStatus {
    pub phase: MobilePhase,
    pub active: bool,
    pub elapsed_seconds: f64,
    pub device_name: Option<String>,
    pub project_path: Option<PathBuf>,
    pub error: Option<String>,
    pub notice: Option<String>,
}

#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MobileRecordingOptions {
    pub platform: MobilePlatform,
    pub device_id: String,
    pub audio: bool,
    pub preview: bool,
}

struct Session {
    stop: watch::Sender<bool>,
    done: watch::Receiver<Option<Result<PathBuf, String>>>,
    started: Instant,
    timed: bool,
}
impl Drop for Session {
    fn drop(&mut self) {
        self.stop.send_replace(true);
    }
}

#[derive(Default)]
pub struct MobileState {
    gate: tokio::sync::Mutex<()>,
    session: Mutex<Option<Session>>,
    status: Arc<Mutex<MobileStatus>>,
}

pub fn active(app: &AppHandle) -> bool {
    app.try_state::<MobileState>()
        .is_some_and(|state| state.status.lock().unwrap().active)
}

pub fn owns_active_project(app: &AppHandle, path: &Path) -> bool {
    app.try_state::<MobileState>().is_some_and(|state| {
        let status = state.status.lock().unwrap();
        status.active
            && status.project_path.as_ref().is_some_and(|project| {
                project == path
                    || project.canonicalize().ok().is_some_and(|canonical| {
                        path.canonicalize()
                            .is_ok_and(|candidate| candidate == canonical)
                    })
            })
    })
}

fn tool(name: &str) -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let mut folders: Vec<_> =
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).collect();
    folders.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        home.join("homebrew/bin"),
        home.join("Library/Android/sdk/platform-tools"),
    ]);
    folders
        .into_iter()
        .map(|folder| folder.join(name))
        .find(|path| path.is_file())
}

fn ios_helper() -> Option<PathBuf> {
    let path = std::env::current_exe()
        .ok()?
        .parent()?
        .join("jianku-device-capture");
    path.is_file().then_some(path)
}

async fn output(command: &mut Command) -> Result<std::process::Output, String> {
    command.kill_on_drop(true);
    tokio::time::timeout(Duration::from_secs(8), command.output())
        .await
        .map_err(|_| "设备查询超时，请检查 USB 连接".to_string())?
        .map_err(|error| error.to_string())
}

fn parse_android_devices(text: &str) -> Vec<MobileDevice> {
    text.lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let id = fields.next()?;
            let connection = fields.next()?;
            if !["device", "unauthorized", "offline"].contains(&connection) {
                return None;
            }
            let metadata: Vec<_> = fields.collect();
            let name = metadata
                .iter()
                .find_map(|field| field.strip_prefix("model:"))
                .unwrap_or("安卓设备")
                .replace('_', " ");
            Some(MobileDevice {
                id: id.into(),
                name,
                platform: MobilePlatform::Android,
                authorized: connection == "device",
                audio_supported: false,
                mi6_compatibility: metadata.contains(&"product:sagit")
                    && metadata.contains(&"device:sagit"),
            })
        })
        .collect()
}

#[derive(Deserialize)]
struct IosDevices {
    devices: Vec<IosDevice>,
}
#[derive(Deserialize)]
struct IosDevice {
    id: String,
    name: String,
    audio: bool,
}

#[tauri::command]
#[specta::specta]
pub async fn get_mobile_setup() -> Result<MobileSetup, String> {
    if !cfg!(target_os = "macos") {
        return Err("移动设备录制目前仅支持 macOS".into());
    }
    let adb = tool("adb");
    let scrcpy = tool("scrcpy");
    let helper = ios_helper();
    let mut setup = MobileSetup {
        devices: Vec::new(),
        android_ready: adb.is_some() && scrcpy.is_some(),
        ios_ready: helper.is_some(),
        warnings: Vec::new(),
    };
    if let Some(adb) = &adb {
        match output(Command::new(adb).args(["devices", "-l"])).await {
            Ok(result) if result.status.success() => {
                let mut devices = parse_android_devices(&String::from_utf8_lossy(&result.stdout));
                for device in &mut devices {
                    if device.authorized {
                        let version = output(Command::new(adb).args([
                            "-s",
                            &device.id,
                            "shell",
                            "getprop",
                            "ro.build.version.sdk",
                        ]))
                        .await;
                        device.audio_supported = version
                            .ok()
                            .and_then(|value| {
                                String::from_utf8_lossy(&value.stdout)
                                    .trim()
                                    .parse::<u32>()
                                    .ok()
                            })
                            .is_some_and(|api| api >= 30);
                    }
                }
                setup.devices.extend(devices);
            }
            _ => setup
                .warnings
                .push("安卓设备查询失败，请检查 USB 连接。".into()),
        }
    }
    if !setup.android_ready {
        setup
            .warnings
            .push("安卓录制需要本机安装 adb 和 scrcpy。".into());
    }
    if let Some(helper) = helper {
        match output(Command::new(helper).arg("list")).await {
            Ok(result) if result.status.success() => {
                let devices: IosDevices =
                    serde_json::from_slice(&result.stdout).map_err(|error| error.to_string())?;
                setup
                    .devices
                    .extend(devices.devices.into_iter().map(|device| MobileDevice {
                        id: device.id,
                        name: device.name,
                        platform: MobilePlatform::Ios,
                        authorized: true,
                        audio_supported: device.audio,
                        mi6_compatibility: false,
                    }));
            }
            _ => setup
                .warnings
                .push("iOS 设备查询失败，请检查 USB 信任并解锁设备。".into()),
        }
    }
    Ok(setup)
}

#[tauri::command]
#[specta::specta]
pub fn get_mobile_status(app: AppHandle) -> MobileStatus {
    let state = app.state::<MobileState>();
    let mut status = state.status.lock().unwrap().clone();
    if status.active
        && let Some(session) = state.session.lock().unwrap().as_mut()
    {
        if status.phase == MobilePhase::Recording && !session.timed {
            session.started = Instant::now();
            session.timed = true;
        }
        status.elapsed_seconds = if session.timed {
            session.started.elapsed().as_secs_f64()
        } else {
            0.0
        };
    }
    status
}

fn project_meta(
    project: &Path,
    source: &str,
    name: &str,
    fps: u32,
    audio: bool,
    status: StudioRecordingStatus,
) -> RecordingMeta {
    RecordingMeta {
        platform: Some(Platform::default()),
        project_path: project.into(),
        pretty_name: name.into(),
        sharing: None,
        upload: None,
        inner: RecordingMetaInner::Studio(Box::new(StudioRecordingMeta::MultipleSegments {
            inner: MultipleSegments {
                segments: vec![MultipleSegment {
                    display: VideoMeta {
                        path: RelativePathBuf::from(source),
                        fps,
                        start_time: Some(0.0),
                        device_id: None,
                    },
                    camera: None,
                    mic: None,
                    system_audio: audio.then(|| AudioMeta {
                        path: RelativePathBuf::from(source),
                        start_time: Some(0.0),
                        device_id: None,
                        gap_summary: None,
                    }),
                    cursor: None,
                    keyboard: None,
                    display_notch: None,
                }],
                cursors: Cursors::default(),
                status: Some(status),
            },
        })),
    }
}

fn finalize_project(project: &Path, source: &str, name: &str) -> Result<(), String> {
    let raw = project.join(source);
    if !cap_enc_ffmpeg::remux::probe_video_can_decode(&raw).map_err(|error| error.to_string())? {
        return Err("录制没有收到可解码的画面，原始文件已保留。".into());
    }
    let duration = cap_enc_ffmpeg::remux::get_media_duration(&raw).ok_or("无法读取录制时长")?;
    if duration.as_secs_f64() < 0.05 {
        return Err("录制过短，原始文件已保留。".into());
    }
    let input = ffmpeg::format::input(&raw).map_err(|error| error.to_string())?;
    let video = input
        .streams()
        .best(ffmpeg::media::Type::Video)
        .ok_or("未找到设备视频")?;
    let rate = video.avg_frame_rate();
    let decoder = ffmpeg::codec::context::Context::from_parameters(video.parameters())
        .and_then(|context| context.decoder().video())
        .map_err(|error| error.to_string())?;
    let size = (decoder.width(), decoder.height());
    let fps = if rate.denominator() > 0 {
        (f64::from(rate.numerator()) / f64::from(rate.denominator()))
            .round()
            .clamp(1.0, 240.0) as u32
    } else {
        60
    };
    let has_audio = input.streams().best(ffmpeg::media::Type::Audio).is_some();
    drop(input);
    let mut meta = if project.join("recording-meta.json").exists() {
        RecordingMeta::load_for_project(project).map_err(|error| error.to_string())?
    } else {
        project_meta(
            project,
            source,
            name,
            fps,
            has_audio,
            StudioRecordingStatus::InProgress,
        )
    };
    let RecordingMetaInner::Studio(studio) = &mut meta.inner else {
        return Err("设备工程结构不受支持，原文件未修改。".into());
    };
    let StudioRecordingMeta::MultipleSegments { inner } = studio.as_mut() else {
        return Err("设备工程结构不受支持，原文件未修改。".into());
    };
    if inner.segments.len() != 1 || inner.segments[0].display.path.as_str() != source {
        return Err("设备工程的媒体片段不匹配，原文件未修改。".into());
    }
    let config_path = project.join("project-config.json");
    if config_path.exists() {
        let config: cap_project::ProjectConfiguration =
            serde_json::from_slice(&std::fs::read(config_path).map_err(|error| error.to_string())?)
                .map_err(|error| format!("已有编辑设置无法读取，文件已保留：{error}"))?;
        config.validate().map_err(|error| error.to_string())?;
    } else {
        let mut config = crate::recording::default_project_config();
        config.cursor.hide = true;
        config.camera.hide = true;
        let short_edge = size.0.min(size.1).max(1);
        let aspect = f64::from(size.0.max(size.1)) / f64::from(short_edge);
        config.background.frame = Some(cap_project::FrameConfiguration {
            style: if aspect >= 1.7 {
                cap_project::FrameStyle::Phone
            } else {
                cap_project::FrameStyle::Tablet
            },
            ..Default::default()
        });
        config.write(project).map_err(|error| error.to_string())?;
    }
    inner.segments[0].display.fps = fps;
    if has_audio && inner.segments[0].system_audio.is_none() {
        inner.segments[0].system_audio = Some(AudioMeta {
            path: RelativePathBuf::from(source),
            start_time: Some(0.0),
            device_id: None,
            gap_summary: None,
        });
    }
    inner.status = Some(StudioRecordingStatus::Complete);
    meta.save_for_project().map_err(|error| error.to_string())
}

fn finalize_capture(
    project: &Path,
    source: &str,
    name: &str,
    capture_result: Result<(), String>,
) -> Result<Option<String>, String> {
    match finalize_project(project, source, name) {
        Ok(()) => Ok(capture_result.err().map(|reason| {
            format!("录制提前结束，已保存收到的可用画面。请在编辑器检查结尾。原因：{reason}")
        })),
        Err(error) => Err(match capture_result {
            Ok(()) => error,
            Err(reason) => format!("{reason} {error}"),
        }),
    }
}

fn capture_exit_status(status: std::process::ExitStatus) -> Result<(), String> {
    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "设备录制进程异常退出（{status}），正在检查已收到的画面。"
        ))
    }
}

async fn publish_saved_project(app: &AppHandle, project: &Path, source: &str) -> Option<String> {
    if let Err(error) = crate::project_files::remember_project(app, project.to_path_buf()) {
        tracing::warn!(%error, "Mobile project could not be added to local history");
    }
    let screenshot = project.join("screenshots/display.jpg");
    if !screenshot.exists() {
        if let Some(parent) = screenshot.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = crate::create_screenshot(project.join(source), screenshot, None).await;
    }
    let _ = crate::NewStudioRecordingAdded {
        path: project.to_path_buf(),
    }
    .emit(app);
    if !crate::app_is_exiting(app)
        && let Err(error) = (crate::windows::ShowCapWindow::Editor {
            project_path: project.to_path_buf(),
        })
        .show(app)
        .await
    {
        return Some(format!("工程已保存，可从录制库打开。{error}"));
    }
    None
}

fn recording_command(
    device: &MobileDevice,
    options: &MobileRecordingOptions,
    source: &Path,
) -> Result<Command, String> {
    match device.platform {
        MobilePlatform::Android => {
            let adb = tool("adb").ok_or("本机未安装 adb")?;
            let mut command = Command::new(tool("scrcpy").ok_or("本机未安装 scrcpy")?);
            command
                .env("ADB", adb)
                .args([
                    "--serial",
                    &device.id,
                    "--video-codec=h264",
                    "--video-bit-rate=16M",
                    "--max-fps=60",
                ])
                .arg(format!("--record={}", source.display()));
            if options.audio && device.audio_supported {
                command.args(["--audio-codec=aac", "--no-audio-playback"]);
            } else {
                command.arg("--no-audio");
            }
            if options.preview {
                command.arg("--window-title=简库设备预览");
            } else {
                command.args(["--no-playback", "--no-window"]);
                if !device.mi6_compatibility {
                    command.arg("--no-control");
                }
            }
            Ok(command)
        }
        MobilePlatform::Ios => {
            let mut command = Command::new(ios_helper().ok_or("iOS 捕获组件缺失，请重新安装应用")?);
            command
                .arg("record")
                .arg(&device.id)
                .arg(source)
                .arg(if options.audio { "true" } else { "false" })
                .arg(if options.preview { "true" } else { "false" });
            Ok(command)
        }
    }
}

async fn drain(
    reader: impl tokio::io::AsyncRead + Unpin,
    status: Arc<Mutex<MobileStatus>>,
    device_id: String,
) {
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let mut status = status.lock().unwrap();
        if line.contains("Recording started to") || line.contains("\"event\":\"started\"") {
            if status.phase == MobilePhase::Starting {
                status.phase = MobilePhase::Recording;
            }
        } else if line.starts_with("ERROR:") || line.starts_with("WARN:") {
            status.notice = Some(line.replace(&device_id, "设备"));
        } else if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line)
            && [Some("error"), Some("disconnected")]
                .contains(&value.get("event").and_then(serde_json::Value::as_str))
        {
            status.notice = value
                .get("message")
                .and_then(serde_json::Value::as_str)
                .map(|message| message.replace(&device_id, "设备"));
        }
    }
}

async fn interrupt(
    child: &mut tokio::process::Child,
    stdin: &mut Option<tokio::process::ChildStdin>,
    platform: MobilePlatform,
) -> Result<(), String> {
    if platform == MobilePlatform::Ios {
        if let Some(stdin) = stdin {
            stdin
                .write_all(b"stop\n")
                .await
                .map_err(|error| error.to_string())?;
        }
    } else if let Some(pid) = child.id() {
        let result = Command::new("/bin/kill")
            .args(["-INT", &pid.to_string()])
            .status()
            .await
            .map_err(|error| error.to_string())?;
        if !result.success() {
            return Err("无法通知设备录制保存".into());
        }
    }
    Ok(())
}

async fn capture(
    mut command: Command,
    platform: MobilePlatform,
    source: &Path,
    mut stop: watch::Receiver<bool>,
    status: Arc<Mutex<MobileStatus>>,
    device_id: String,
) -> Result<(), String> {
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| format!("设备录制启动失败：{error}"))?;
    let mut stdin = child.stdin.take();
    let stdout_task = child
        .stdout
        .take()
        .map(|reader| tokio::spawn(drain(reader, status.clone(), device_id.clone())));
    let stderr_task = child
        .stderr
        .take()
        .map(|reader| tokio::spawn(drain(reader, status.clone(), device_id)));
    let mut interval = tokio::time::interval(Duration::from_millis(250));
    let startup = Instant::now();
    let mut requested_stop = false;
    let result = loop {
        if *stop.borrow() && !requested_stop {
            requested_stop = true;
            status.lock().unwrap().phase = MobilePhase::Finalizing;
            if let Err(error) = interrupt(&mut child, &mut stdin, platform).await {
                break Err(error);
            }
        }
        if requested_stop {
            let result = tokio::time::timeout(Duration::from_secs(20), child.wait()).await;
            break match result {
                Ok(Ok(status)) => capture_exit_status(status),
                Ok(Err(error)) => Err(error.to_string()),
                Err(_) => Err("设备保存超时，原始文件已保留。".into()),
            };
        }
        tokio::select! {
            result = child.wait() => { break result.map_err(|error| error.to_string()).and_then(capture_exit_status); }
            changed = stop.changed() => { if changed.is_err() { stop.mark_changed(); requested_stop = true; let _ = interrupt(&mut child, &mut stdin, platform).await; } }
            _ = interval.tick() => {
                if source.metadata().is_ok_and(|meta| meta.len() > 128) {
                    let mut state = status.lock().unwrap();
                    if state.phase == MobilePhase::Starting { state.phase = MobilePhase::Recording; }
                } else if startup.elapsed() > Duration::from_secs(25) {
                    let _ = interrupt(&mut child, &mut stdin, platform).await;
                    let _ = tokio::time::timeout(Duration::from_secs(5), child.wait()).await;
                    break Err("设备未传来画面，请解锁设备并检查 USB 授权。".into());
                }
            }
        }
    };
    if child.try_wait().ok().flatten().is_none() {
        let _ = child.kill().await;
        let _ = child.wait().await;
    }
    for mut task in [stdout_task, stderr_task].into_iter().flatten() {
        if tokio::time::timeout(Duration::from_secs(2), &mut task)
            .await
            .is_err()
        {
            task.abort();
            let _ = task.await;
        }
    }
    result
}

#[tauri::command]
#[specta::specta]
pub async fn start_mobile_recording(
    app: AppHandle,
    options: MobileRecordingOptions,
) -> Result<MobileStatus, String> {
    let capture_gate = app.state::<CaptureStartGate>();
    let _capture_guard = capture_gate.0.lock().await;
    let state = app.state::<MobileState>();
    let _guard = state.gate.lock().await;
    if active(&app)
        || crate::presentation::active(&app)
        || app
            .state::<crate::ArcLock<crate::App>>()
            .read()
            .await
            .is_recording_active_or_pending()
    {
        return Err("请先结束当前录制或演示。".into());
    }
    if crate::EditorRecordingTarget::current(&app).is_some() {
        return Err("请先退出为已有工程录制片段的流程。".into());
    }
    let setup = get_mobile_setup().await?;
    let device = setup
        .devices
        .into_iter()
        .find(|device| {
            device.id == options.device_id
                && device.platform == options.platform
                && device.authorized
        })
        .ok_or("设备已断开或尚未授权，请刷新设备列表。")?;
    if device.mi6_compatibility {
        let adb = tool("adb").ok_or("本机未安装 adb")?;
        let mut ready = false;
        for _ in 0..3 {
            let warmup = output(Command::new(&adb).args([
                "-s",
                &device.id,
                "shell",
                "echo",
                "jianku-ready",
            ]))
            .await;
            if warmup.is_ok_and(|result| result.status.success()) {
                ready = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(300)).await;
        }
        if !ready {
            return Err(
                "MI 6 连接尚未就绪，请检查有线连接后重试；设备应用和网络设置未改动。".into(),
            );
        }
    }
    let name = format!(
        "{} {}",
        device.name,
        chrono::Local::now().format("%Y-%m-%d %H.%M.%S")
    );
    let root = crate::general_settings::GeneralSettingsStore::recordings_dir(&app);
    std::fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let filename = format!("{}.jks", sanitize_filename::sanitize(&name));
    let unique =
        cap_utils::ensure_unique_filename(&filename, &root).map_err(|error| error.to_string())?;
    let project = root.join(unique);
    std::fs::create_dir(&project).map_err(|error| error.to_string())?;
    std::fs::create_dir_all(project.join("content/mobile")).map_err(|error| error.to_string())?;
    let source = if device.platform == MobilePlatform::Android {
        "content/mobile/source.mp4"
    } else {
        "content/mobile/source.mov"
    };
    project_meta(
        &project,
        source,
        &name,
        60,
        false,
        StudioRecordingStatus::InProgress,
    )
    .save_for_project()
    .map_err(|error| error.to_string())?;
    let command = recording_command(&device, &options, &project.join(source))?;
    std::fs::write(project.join("mobile-source.json"), serde_json::to_vec_pretty(&serde_json::json!({"platform":device.platform, "deviceName":device.name, "touchEventsAvailable":false, "source":source})).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;
    let initial = MobileStatus {
        phase: MobilePhase::Starting,
        active: true,
        device_name: Some(device.name.clone()),
        project_path: Some(project.clone()),
        ..Default::default()
    };
    *state.status.lock().unwrap() = initial.clone();
    let status = state.status.clone();
    let (stop, stop_rx) = watch::channel(false);
    let (done, done_rx) = watch::channel(None);
    *state.session.lock().unwrap() = Some(Session {
        stop,
        done: done_rx,
        started: Instant::now(),
        timed: false,
    });
    let _ = app.emit("mobile-recording-active", true);
    let app = app.clone();
    let started = Instant::now();
    tokio::spawn(async move {
        let result = capture(
            command,
            device.platform,
            &project.join(source),
            stop_rx,
            status.clone(),
            device.id,
        )
        .await;
        status.lock().unwrap().phase = MobilePhase::Finalizing;
        let result = {
            let project = project.clone();
            let name = name.clone();
            tokio::task::spawn_blocking(move || finalize_capture(&project, source, &name, result))
                .await
                .map_err(|error| error.to_string())
                .and_then(|value| value)
        };
        match &result {
            Ok(notice) => {
                let open_notice = publish_saved_project(&app, &project, source).await;
                if notice.is_some() || open_notice.is_some() {
                    status.lock().unwrap().notice = Some(
                        notice
                            .iter()
                            .chain(open_notice.iter())
                            .cloned()
                            .collect::<Vec<_>>()
                            .join(" "),
                    );
                }
            }
            Err(error) => {
                let _ = project_meta(
                    &project,
                    source,
                    &name,
                    60,
                    false,
                    StudioRecordingStatus::Failed {
                        error: error.clone(),
                    },
                )
                .save_for_project();
            }
        }
        {
            let mut status = status.lock().unwrap();
            status.elapsed_seconds = started.elapsed().as_secs_f64();
            status.active = false;
            status.phase = if result.is_ok() {
                MobilePhase::Complete
            } else {
                MobilePhase::Failed
            };
            status.error = result.as_ref().err().cloned();
        }
        let _ = app.emit("mobile-recording-active", false);
        done.send_replace(Some(result.map(|_| project)));
    });
    Ok(initial)
}

#[tauri::command]
#[specta::specta]
pub async fn stop_mobile_recording(app: AppHandle) -> Result<Option<PathBuf>, String> {
    let state = app.state::<MobileState>();
    let _guard = state.gate.lock().await;
    let receiver = {
        let sessions = state.session.lock().unwrap();
        let Some(session) = sessions.as_ref() else {
            return Ok(None);
        };
        session.stop.send_replace(true);
        session.done.clone()
    };
    let mut receiver = receiver;
    tokio::time::timeout(Duration::from_secs(45), async {
        loop {
            if let Some(result) = receiver.borrow().clone() {
                return result.map(Some);
            }
            receiver
                .changed()
                .await
                .map_err(|_| "录制保存任务已中断，原始文件仍在工程目录。".to_string())?;
        }
    })
    .await
    .map_err(|_| "录制仍在保存，请稍候；原始文件已保留。".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovery_includes_unauthorized_devices_without_treating_server_messages_as_devices() {
        let devices = parse_android_devices(
            "List of devices attached\n* daemon started successfully *\na device product:sagit model:MI_6 transport_id:1\nb unauthorized\nc offline\n",
        );
        assert_eq!(devices.len(), 3);
        assert_eq!(devices[0].name, "MI 6");
        assert!(devices[0].authorized);
        assert!(!devices[0].mi6_compatibility);
        let mi6 = parse_android_devices("mi6 device product:sagit model:MI_6 device:sagit usb:1");
        assert!(mi6[0].mi6_compatibility);
        assert!(!devices[1].authorized);
        assert!(!devices[2].authorized);
    }

    #[test]
    fn mobile_project_keeps_original_video_and_uses_embedded_audio() {
        let root = tempfile::tempdir().unwrap();
        let project = root.path().join("mobile.jks");
        std::fs::create_dir_all(project.join("content/mobile")).unwrap();
        let source = "content/mobile/source.mp4";
        let raw = project.join(source);
        let status =
            std::process::Command::new(tool("ffmpeg").expect("media fixture requires ffmpeg"))
                .args([
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "testsrc2=size=360x640:rate=30",
                    "-f",
                    "lavfi",
                    "-i",
                    "sine=frequency=660:sample_rate=48000",
                    "-t",
                    "0.6",
                    "-c:v",
                    "h264_videotoolbox",
                    "-c:a",
                    "aac",
                    "-y",
                ])
                .arg(&raw)
                .status()
                .unwrap();
        assert!(status.success());
        let original = std::fs::read(&raw).unwrap();
        finalize_project(&project, source, "Mobile fixture").unwrap();
        assert_eq!(std::fs::read(&raw).unwrap(), original);
        let meta = RecordingMeta::load_for_project(&project).unwrap();
        let RecordingMetaInner::Studio(studio) = meta.inner else {
            panic!("expected editable project");
        };
        assert!(matches!(studio.status(), StudioRecordingStatus::Complete));
        let StudioRecordingMeta::MultipleSegments { inner } = *studio else {
            panic!("expected segmented project");
        };
        let audio = inner.segments[0].system_audio.as_ref().unwrap();
        assert_eq!(audio.path, inner.segments[0].display.path);
        assert!(cap_audio::AudioData::from_file(audio.path.to_path(&project)).is_ok());
        assert!(project.join("project-config.json").is_file());
        let config = cap_project::ProjectConfiguration::load(&project).unwrap();
        assert_eq!(
            config.background.frame.unwrap().style,
            cap_project::FrameStyle::Phone
        );
        assert!(config.cursor.hide && config.camera.hide);
    }

    #[tokio::test]
    async fn stopping_owned_capture_flushes_before_returning() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source.mp4");
        let mut command = Command::new("/bin/sh");
        command.arg("-c").arg("trap 'printf flushed >> \"$1\"; exit 0' INT; printf started > \"$1\"; while :; do sleep 0.1; done").arg("capture-fixture").arg(&source);
        let (stop, receiver) = watch::channel(false);
        let status = Arc::new(Mutex::new(MobileStatus::default()));
        let worker_source = source.clone();
        let worker = tokio::spawn(async move {
            capture(
                command,
                MobilePlatform::Android,
                &worker_source,
                receiver,
                status,
                "fixture".into(),
            )
            .await
        });
        tokio::time::timeout(Duration::from_secs(5), async {
            while !source.exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        stop.send_replace(true);
        worker.await.unwrap().unwrap();
        assert_eq!(std::fs::read(&source).unwrap(), b"startedflushed");
    }

    #[tokio::test]
    async fn nonzero_capture_exit_is_reported_with_device_diagnostics() {
        let root = tempfile::tempdir().unwrap();
        let mut command = Command::new("/bin/sh");
        command.args([
            "-c",
            "printf 'ERROR: fixture-serial disconnected\\n' >&2; exit 7",
        ]);
        let (_stop, receiver) = watch::channel(false);
        let status = Arc::new(Mutex::new(MobileStatus::default()));
        let error = capture(
            command,
            MobilePlatform::Android,
            &root.path().join("source.mp4"),
            receiver,
            status.clone(),
            "fixture-serial".into(),
        )
        .await
        .unwrap_err();
        assert!(error.contains("7"));
        assert_eq!(
            status.lock().unwrap().notice.as_deref(),
            Some("ERROR: 设备 disconnected")
        );
    }
}

#[cfg(debug_assertions)]
pub fn run_smoke(app: AppHandle) {
    use std::sync::atomic::{AtomicBool, Ordering};
    static STARTED: AtomicBool = AtomicBool::new(false);
    let Some(output_path) = std::env::var_os("JIANKU_MOBILE_SMOKE_OUTPUT") else {
        return;
    };
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    tokio::spawn(async move {
        let result = async {
            let setup = get_mobile_setup().await?;
            let device = setup.devices.into_iter().find(|device| device.authorized && device.platform == MobilePlatform::Android).ok_or("No authorized Android device connected")?;
            let initial = start_mobile_recording(app.clone(), MobileRecordingOptions { platform: device.platform, device_id: device.id, audio: false, preview: false }).await?;
            tokio::time::timeout(Duration::from_secs(30), async {
                loop {
                    let status = get_mobile_status(app.clone());
                    if status.phase == MobilePhase::Recording { return Ok::<_, String>(()); }
                    if !status.active { return Err(status.error.unwrap_or_else(|| "Device stopped before capture started".into())); }
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            }).await.map_err(|_| "Device startup timed out")??;
            tokio::time::sleep(Duration::from_secs(6)).await;
            let path = stop_mobile_recording(app.clone()).await?.ok_or("No project saved")?;
            let meta = RecordingMeta::load_for_project(&path).map_err(|error| error.to_string())?;
            let media = path.join("content/mobile/source.mp4");
            let input = ffmpeg::format::input(&media).map_err(|error| error.to_string())?;
            let stream = input.streams().best(ffmpeg::media::Type::Video).ok_or("No video")?;
            let decoder = ffmpeg::codec::context::Context::from_parameters(stream.parameters()).map_err(|error| error.to_string())?.decoder().video().map_err(|error| error.to_string())?;
            Ok::<_, String>(serde_json::json!({
                "ok": true, "platform":"android", "extension":path.extension().and_then(|value| value.to_str()),
                "width":decoder.width(), "height":decoder.height(), "duration":cap_enc_ffmpeg::remux::get_media_duration(&media).map(|value| value.as_secs_f64()),
                "sourceBytes": media.metadata().map_err(|error| error.to_string())?.len(),
                "sourceAudioSupported":device.audio_supported,
                "mi6Compatibility":device.mi6_compatibility,
                "complete": matches!(meta.inner, RecordingMetaInner::Studio(ref studio) if matches!(studio.status(), StudioRecordingStatus::Complete)),
                "started":initial.active, "stopped":!active(&app),
                "editorOpened":app.webview_windows().keys().any(|label| label.starts_with("editor")),
                "deviceSerialSaved":false, "userFramesSavedInRepository":false
            }))
        }.await;
        let value = match result {
            Ok(value) => value,
            Err(error) => serde_json::json!({"ok":false,"error":error}),
        };
        if let Ok(bytes) = serde_json::to_vec_pretty(&value) {
            let _ = std::fs::write(output_path, bytes);
        }
    });
}
