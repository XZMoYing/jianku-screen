use cap_project::{AspectRatio, ProjectConfiguration};
use cap_rendering::live::LiveFocusMode;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

#[derive(Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PresentationOptions {
    pub source_id: String,
    #[specta(type = Option<u32>)]
    pub output_monitor: Option<usize>,
    pub output_width: u32,
    pub output_height: u32,
    #[serde(default)]
    pub output_resolution: u32,
    #[serde(default)]
    pub output_aspect_ratio: Option<AspectRatio>,
    pub focus_mode: LiveFocusMode,
    pub zoom_amount: f64,
    pub idle_seconds: f64,
    pub shortcut: String,
    pub project: ProjectConfiguration,
    #[serde(default)]
    #[specta(type = f64)]
    pub toggle_epoch: u64,
}

fn output_size(resolution: u32, ratio: f64) -> (u32, u32) {
    let short_edge = f64::from(resolution) * 9.0 / 16.0;
    let (width, height) = if ratio >= 1.0 {
        (f64::from(resolution), short_edge)
    } else {
        (short_edge, f64::from(resolution))
    };
    let scale = (width / ratio).min(height);
    let even = |value: f64| ((value / 2.0).round() as u32 * 2).max(2);
    (even(scale * ratio), even(scale))
}

impl PresentationOptions {
    fn normalize(&mut self, app: &AppHandle, live_ratio: Option<f64>) -> Result<(), String> {
        if self.output_resolution == 0 {
            self.output_resolution = if [1280, 1920, 2560, 3840].contains(&self.output_width) {
                self.output_width
            } else {
                1920
            };
        }
        if ![1280, 1920, 2560, 3840].contains(&self.output_resolution) {
            return Err("请选择有效的输出清晰度".into());
        }
        let ratio = if let Some(aspect) = &self.output_aspect_ratio {
            aspect.ratio()
        } else if let Some(ratio) = live_ratio {
            ratio
        } else if let Some(index) = self.output_monitor {
            let monitors = app
                .available_monitors()
                .map_err(|error| error.to_string())?;
            let monitor = monitors.get(index).ok_or("输出显示器已断开")?;
            f64::from(monitor.size().width) / f64::from(monitor.size().height)
        } else {
            let source = scap_targets::Display::list()
                .into_iter()
                .find(|display| display.id().to_string() == self.source_id)
                .ok_or("来源显示器已断开")?;
            let size = source.physical_size().ok_or("无法读取来源屏幕尺寸")?;
            f64::from(size.width()) / f64::from(size.height())
        };
        (self.output_width, self.output_height) = output_size(self.output_resolution, ratio);
        Ok(())
    }

    fn validate(&self) -> Result<(), String> {
        if !(320..=7680).contains(&self.output_width)
            || !(240..=4320).contains(&self.output_height)
            || self.output_width % 2 != 0
            || self.output_height % 2 != 0
        {
            return Err("输出宽高需要是有效的偶数像素".into());
        }
        if !self.zoom_amount.is_finite()
            || !(1.0..=4.0).contains(&self.zoom_amount)
            || !self.idle_seconds.is_finite()
            || !(1.0..=30.0).contains(&self.idle_seconds)
        {
            return Err("请检查放大倍率和空闲时间".into());
        }
        self.project.validate().map_err(|error| error.to_string())?;
        self.shortcut
            .parse::<Shortcut>()
            .map_err(|error| error.to_string())?;
        Ok(())
    }
}

#[derive(Clone, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PresentationStatus {
    pub active: bool,
    #[specta(type = f64)]
    pub frames: u64,
    pub processing_ms: f64,
    pub error: Option<String>,
    pub ws_port: u16,
    pub output_detached: bool,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PresentationMonitor {
    #[specta(type = u32)]
    pub index: usize,
    pub name: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PresentationSetup {
    pub supported: bool,
    pub displays: Vec<cap_recording::screen_capture::CaptureDisplay>,
    pub monitors: Vec<PresentationMonitor>,
    pub options: PresentationOptions,
}

struct Session {
    cancel: CancellationToken,
    options: watch::Sender<PresentationOptions>,
    shortcut: Shortcut,
    thread: Option<std::thread::JoinHandle<()>>,
}
impl Drop for Session {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}

#[derive(Default)]
pub struct PresentationState {
    gate: tokio::sync::Mutex<()>,
    session: Mutex<Option<Session>>,
    status: Arc<Mutex<PresentationStatus>>,
}

pub fn active(app: &AppHandle) -> bool {
    app.try_state::<PresentationState>()
        .is_some_and(|state| state.status.lock().unwrap().active)
}

#[tauri::command]
#[specta::specta]
pub async fn show_presentation(app: AppHandle) -> Result<(), String> {
    let window = crate::windows::ShowCapWindow::Main {
        init_target_mode: None,
    }
    .show(&app)
    .await
    .map_err(|error| error.to_string())?;
    window.eval("localStorage.setItem('jianku.main.mode', 'presentation'); window.dispatchEvent(new Event('jianku-main-mode')); ").map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn get_presentation_setup(app: AppHandle) -> Result<PresentationSetup, String> {
    use tauri_plugin_store::StoreExt;
    let displays: Vec<_> = cap_recording::screen_capture::list_displays()
        .into_iter()
        .map(|(info, _)| info)
        .collect();
    let monitors = app
        .available_monitors()
        .map_err(|e| e.to_string())?
        .into_iter()
        .enumerate()
        .map(|(index, monitor)| PresentationMonitor {
            index,
            name: monitor
                .name()
                .cloned()
                .unwrap_or_else(|| format!("显示器 {}", index + 1)),
            width: monitor.size().width,
            height: monitor.size().height,
        })
        .collect();
    let live_options = app.try_state::<PresentationState>().and_then(|state| {
        let sessions = state.session.lock().unwrap();
        sessions
            .as_ref()
            .map(|session| session.options.borrow().clone())
    });
    let mut options = live_options
        .clone()
        .or_else(|| {
            app.store("store")
                .ok()
                .and_then(|store| store.get("presentation-options"))
                .and_then(|value| serde_json::from_value::<PresentationOptions>(value).ok())
                .filter(|options| options.validate().is_ok())
        })
        .unwrap_or(PresentationOptions {
            source_id: scap_targets::Display::primary().id().to_string(),
            output_monitor: None,
            output_width: 1920,
            output_height: 1080,
            output_resolution: 1920,
            output_aspect_ratio: None,
            focus_mode: LiveFocusMode::Automatic,
            zoom_amount: 1.8,
            idle_seconds: 4.0,
            shortcut: "CommandOrControl+Shift+Space".into(),
            project: crate::recording::default_project_config(),
            toggle_epoch: 0,
        });
    options.project.timeline = None;
    options.project.camera.hide = true;
    options.project.clips.clear();
    options.project.annotations.clear();
    if !displays
        .iter()
        .any(|display| display.id.to_string() == options.source_id)
    {
        options.source_id = scap_targets::Display::primary().id().to_string();
    }
    if options
        .output_monitor
        .is_some_and(|index| index >= app.available_monitors().map_or(0, |m| m.len()))
    {
        options.output_monitor = None;
    }
    options.normalize(
        &app,
        live_options
            .as_ref()
            .map(|options| f64::from(options.output_width) / f64::from(options.output_height)),
    )?;
    Ok(PresentationSetup {
        supported: cfg!(target_os = "macos"),
        displays,
        monitors,
        options,
    })
}

#[tauri::command]
#[specta::specta]
pub fn get_presentation_status(app: AppHandle) -> PresentationStatus {
    app.state::<PresentationState>()
        .status
        .lock()
        .unwrap()
        .clone()
}

#[tauri::command]
#[specta::specta]
pub fn update_presentation(
    app: AppHandle,
    mut options: PresentationOptions,
) -> Result<PresentationOptions, String> {
    use tauri_plugin_store::StoreExt;
    let state = app.state::<PresentationState>();
    let sessions = state.session.lock().unwrap();
    if let Some(session) = sessions.as_ref() {
        let current = session.options.borrow().clone();
        if current.source_id != options.source_id
            || current.output_monitor != options.output_monitor
            || current.shortcut != options.shortcut
            || current.output_aspect_ratio != options.output_aspect_ratio
        {
            return Err("请先停止演示，再更换来源、输出位置、比例或快捷键".into());
        }
        options.toggle_epoch = current.toggle_epoch;
        options.normalize(
            &app,
            Some(f64::from(current.output_width) / f64::from(current.output_height)),
        )?;
        options.validate()?;
        session.options.send_replace(options.clone());
        let _ = app.emit("presentation-output-settings", &options);
        return Ok(options);
    }
    drop(sessions);
    options.normalize(&app, None)?;
    options.validate()?;
    let store = app.store("store").map_err(|error| error.to_string())?;
    store.set(
        "presentation-options",
        serde_json::to_value(&options).map_err(|error| error.to_string())?,
    );
    store.save().map_err(|error| error.to_string())?;
    Ok(options)
}

#[tauri::command]
#[specta::specta]
pub fn toggle_presentation_focus(app: AppHandle) -> Result<(), String> {
    let state = app.state::<PresentationState>();
    if let Some(session) = state.session.lock().unwrap().as_ref() {
        let mut options = session.options.borrow().clone();
        options.focus_mode = LiveFocusMode::Manual;
        options.toggle_epoch = options.toggle_epoch.wrapping_add(1);
        session.options.send_replace(options.clone());
        app.emit("presentation-options-changed", &options)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn handle_shortcut(app: &AppHandle, shortcut: &Shortcut, pressed: bool) -> bool {
    let matches = app.try_state::<PresentationState>().is_some_and(|state| {
        state
            .session
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|session| session.shortcut == *shortcut)
    });
    if matches && pressed {
        let _ = toggle_presentation_focus(app.clone());
    }
    matches
}

async fn stop_locked(app: &AppHandle, state: &PresentationState) {
    let session = state.session.lock().unwrap().take();
    if let Some(mut session) = session {
        session.cancel.cancel();
        let _ = app.global_shortcut().unregister(session.shortcut);
        if let Some(thread) = session.thread.take() {
            let _ = tokio::task::spawn_blocking(move || thread.join()).await;
        }
    }
    if let Some(window) = app.get_webview_window("presentation-output") {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let sender = Arc::new(Mutex::new(Some(sender)));
        window.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::Destroyed)
                && let Some(sender) = sender.lock().unwrap().take()
            {
                let _ = sender.send(());
            }
        });
        if window.close().is_ok() {
            let _ = tokio::time::timeout(std::time::Duration::from_secs(3), async {
                let _ = receiver.await;
                while app.get_webview_window("presentation-output").is_some() {
                    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
                }
            })
            .await;
        }
    }
    state.status.lock().unwrap().active = false;
}

#[tauri::command]
#[specta::specta]
pub async fn stop_presentation(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;
    let state = app.state::<PresentationState>();
    let _guard = state.gate.lock().await;
    let options = state
        .session
        .lock()
        .unwrap()
        .as_ref()
        .map(|session| session.options.borrow().clone());
    let save_result = (|| -> Result<(), String> {
        if let Some(options) = options
            && let Ok(store) = app.store("store")
        {
            store.set(
                "presentation-options",
                serde_json::to_value(options).map_err(|error| error.to_string())?,
            );
            store.save().map_err(|error| error.to_string())?;
        }
        Ok(())
    })();
    stop_locked(&app, &state).await;
    save_result
}

#[tauri::command]
#[specta::specta]
pub async fn start_presentation(
    app: AppHandle,
    mut options: PresentationOptions,
) -> Result<PresentationStatus, String> {
    crate::permissions::require_capture_permissions(&app, true).await?;
    let capture_gate = app.state::<crate::mobile::CaptureStartGate>();
    let _capture_guard = capture_gate.0.lock().await;
    if crate::mobile::active(&app) {
        return Err("请先结束设备录制，再开始演示".into());
    }
    if crate::capture_style::saved(&app)?.is_some_and(|style| style.desktop_wallpaper) {
        let path = crate::capture_style::get_current_wallpaper_preview(app.clone()).await?;
        options.project.background.source =
            cap_project::BackgroundSource::Image { path: Some(path) };
    }
    options.normalize(&app, None)?;
    options.validate()?;
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        return Err("实时演示捕获正在适配此平台".into());
    }
    #[cfg(target_os = "macos")]
    {
        if app
            .state::<crate::ArcLock<crate::App>>()
            .read()
            .await
            .is_recording_active_or_pending()
        {
            return Err("请先结束录制，再开始演示".into());
        }
        if !scap_screencapturekit::has_permission() {
            return Err("请先在系统设置中授予简库镜传屏幕录制权限，再开始演示".into());
        }
        let state = app.state::<PresentationState>();
        let _guard = state.gate.lock().await;
        if state.session.lock().unwrap().is_some() && !state.status.lock().unwrap().active {
            stop_locked(&app, &state).await;
        }
        if state.session.lock().unwrap().is_some() {
            return Err("演示已经启动，请先停止".into());
        }
        options.project.timeline = None;
        options.project.camera.hide = true;
        options.project.cursor.use_svg = true;
        options.project.clips.clear();
        options.project.annotations.clear();
        let source = scap_targets::Display::list()
            .into_iter()
            .find(|display| display.id().to_string() == options.source_id)
            .ok_or("来源显示器已断开")?;
        let target = if let Some(index) = options.output_monitor {
            let monitors = app.available_monitors().map_err(|e| e.to_string())?;
            let monitor = monitors.get(index).cloned().ok_or("输出显示器已断开")?;
            let logical = source.raw_handle().logical_position();
            let primary = scap_targets::Display::primary()
                .raw_handle()
                .logical_position();
            if (monitor.position().x as f64 / monitor.scale_factor() - primary.x()).abs() < 1.0
                && (monitor.position().y as f64 / monitor.scale_factor() - primary.y()).abs() < 1.0
            {
                return Err("请选择副显示器，主显示器保持原样；也可以使用共享窗口".into());
            }
            if (monitor.position().x as f64 / monitor.scale_factor() - logical.x()).abs() < 1.0
                && (monitor.position().y as f64 / monitor.scale_factor() - logical.y()).abs() < 1.0
            {
                return Err("请选择副显示器输出；主显示器保持原有画面。也可以选择共享窗口".into());
            }
            Some(monitor)
        } else {
            None
        };
        options.validate()?;
        let shortcut = options
            .shortcut
            .parse::<Shortcut>()
            .map_err(|e| e.to_string())?;
        if app.global_shortcut().is_registered(shortcut) {
            return Err("这个快捷键已被使用，请换一个".into());
        }
        app.global_shortcut()
            .register(shortcut)
            .map_err(|e| e.to_string())?;
        let preview_scale =
            (960.0 / f64::from(options.output_width)).min(680.0 / f64::from(options.output_height));
        let output = match WebviewWindowBuilder::new(
            &app,
            "presentation-output",
            WebviewUrl::App("/presentation-output".into()),
        )
        .title("简库演示输出")
        .visible(false)
        .focused(false)
        .inner_size(
            f64::from(options.output_width) * preview_scale,
            f64::from(options.output_height) * preview_scale,
        )
        .decorations(false)
        .build()
        {
            Ok(window) => window,
            Err(error) => {
                let _ = app.global_shortcut().unregister(shortcut);
                return Err(error.to_string());
            }
        };
        if target.is_none() && options.output_aspect_ratio.is_some() {
            let window = output.clone();
            let size = (options.output_width, options.output_height);
            if let Err(error) = app.run_on_main_thread(move || {
                if let Ok(pointer) = window.ns_window() {
                    let window = unsafe { &*(pointer as *const objc2_app_kit::NSWindow) };
                    unsafe {
                        window.setContentAspectRatio(objc2_foundation::NSSize::new(
                            f64::from(size.0),
                            f64::from(size.1),
                        ));
                    }
                }
            }) {
                let _ = app.global_shortcut().unregister(shortcut);
                let _ = output.close();
                return Err(error.to_string());
            }
        }
        if let Some(monitor) = &target {
            output
                .set_position(*monitor.position())
                .map_err(|e| e.to_string())?;
            output
                .set_size(*monitor.size())
                .map_err(|e| e.to_string())?;
            output.set_always_on_top(true).map_err(|e| e.to_string())?;
        }
        output.show().map_err(|error| error.to_string())?;
        let _ = app.emit("presentation-options-changed", &options);
        let _ = app.emit("presentation-output-settings", &options);
        let (options_tx, options_rx) = watch::channel(options.clone());
        let (frame_tx, frame_rx) = watch::channel(None);
        let (port, ws_cancel) =
            crate::frame_ws::create_watch_frame_ws(frame_rx, Default::default()).await;
        if port == 0 {
            let _ = app.global_shortcut().unregister(shortcut);
            let _ = output.close();
            return Err("无法建立本地演示画面通道".into());
        }
        let cancel = CancellationToken::new();
        let output_cancel = cancel.clone();
        output.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                output_cancel.cancel();
            }
        });
        let worker_cancel = cancel.clone();
        let status = state.status.clone();
        let worker_app = app.clone();
        *status.lock().unwrap() = PresentationStatus {
            active: true,
            ws_port: port,
            ..Default::default()
        };
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
        let thread = std::thread::Builder::new()
            .name("jianku-presentation".into())
            .stack_size(16 * 1024 * 1024)
            .spawn(move || {
                let runtime = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build();
                let result = match runtime {
                    Ok(runtime) => runtime.block_on(macos::run(
                        worker_app,
                        source,
                        options_rx,
                        frame_tx,
                        worker_cancel,
                        status.clone(),
                        ready_tx,
                        target,
                    )),
                    Err(error) => Err(error.to_string()),
                };
                ws_cancel.cancel();
                let mut value = status.lock().unwrap();
                value.active = false;
                if let Err(error) = result {
                    tracing::error!(%error,"Presentation stopped");
                    value.error = Some(error);
                }
            })
            .map_err(|e| e.to_string())?;
        *state.session.lock().unwrap() = Some(Session {
            cancel,
            options: options_tx,
            shortcut,
            thread: Some(thread),
        });
        match tokio::time::timeout(std::time::Duration::from_secs(20), ready_rx).await {
            Ok(Ok(Ok(()))) => {
                tracing::info!(
                    "Presentation ready; capture frames are composited without video encoding"
                );
                if let Some(session) = state.session.lock().unwrap().as_ref() {
                    let _ = app.emit("presentation-options-changed", &*session.options.borrow());
                }
                Ok(state.status.lock().unwrap().clone())
            }
            result => {
                let message = match result {
                    Ok(Ok(Err(error))) => error,
                    _ => "没有收到演示画面，请检查屏幕录制权限与显示器连接".into(),
                };
                stop_locked(&app, &state).await;
                Err(message)
            }
        }
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use cap_project::{
        CursorClickEvent, CursorEvents, CursorMoveEvent, RecordingMeta, RecordingMetaInner,
        StudioRecordingMeta, XY,
    };
    use cap_rendering::{
        DecodedSegmentFrames, FrameRenderer, LiveRenderInput, ProjectUniforms, RenderOptions,
        RenderVideoConstants, RendererLayers,
        decoder::DecodedFrame,
        live::{LiveMotion, LivePointerInput},
    };
    use cidre::{cg, cv, sc};
    use device_query::{DeviceQuery, DeviceState};
    use std::time::{Duration, Instant};

    unsafe extern "C" {
        fn CGEventSourceCounterForEventType(state: i32, event: u32) -> u32;
    }

    pub async fn run(
        app: AppHandle,
        source: scap_targets::Display,
        mut options: watch::Receiver<PresentationOptions>,
        output: watch::Sender<Option<Arc<crate::frame_ws::WSFrame>>>,
        cancel: CancellationToken,
        status: Arc<Mutex<PresentationStatus>>,
        ready: tokio::sync::oneshot::Sender<Result<(), String>>,
        target: Option<tauri::Monitor>,
    ) -> Result<(), String> {
        let initial = options.borrow().clone();
        let physical = source
            .raw_handle()
            .physical_size()
            .ok_or("无法读取来源屏幕尺寸")?;
        let size = XY::new(
            (physical.width() as u32 + 1) & !1,
            (physical.height() as u32 + 1) & !1,
        );
        let content = sc::ShareableContent::current()
            .await
            .map_err(|e| e.to_string())?;
        let excluded: Vec<_> = content
            .windows()
            .iter()
            .filter(|window| {
                window
                    .owning_app()
                    .is_some_and(|owner| owner.process_id() == std::process::id() as i32)
            })
            .map(|window| window.retained())
            .collect();
        let filter = source
            .raw_handle()
            .as_content_filter_excluding_windows(content, excluded)
            .ok_or("无法建立屏幕捕获来源")?;
        let mut config = scap_screencapturekit::StreamCfgBuilder::default()
            .with_width(size.x as usize)
            .with_height(size.y as usize)
            .with_fps(60.0)
            .with_shows_cursor(false)
            .with_captures_audio(false)
            .with_queue_depth(3)
            .build();
        config.set_pixel_format(cv::PixelFormat::_420V);
        config.set_color_space_name(cg::color_space::names::srgb());
        let (tx, mut rx) = watch::channel::<Option<(DecodedFrame, Instant)>>(None);
        let capture_cancel = cancel.clone();
        let capture_status = status.clone();
        let capturer = scap_screencapturekit::Capturer::builder(filter, config)
            .with_output_sample_buf_cb(move |frame| {
                if let scap_screencapturekit::Frame::Screen(frame) = frame
                    && let Some(image) = frame.image_buf()
                    && image.width() > 0
                    && image.height() > 0
                {
                    let decoded = DecodedFrame::new_nv12_with_image_buf(
                        image.width() as u32,
                        image.height() as u32,
                        image.plane_bytes_per_row(0) as u32,
                        image.plane_bytes_per_row(1) as u32,
                        image.retained(),
                    );
                    tx.send_replace(Some((decoded, Instant::now())));
                }
            })
            .with_stop_with_err_cb(move |_, error| {
                capture_status.lock().unwrap().error = Some(format!("屏幕捕获已停止：{error}"));
                capture_cancel.cancel();
            })
            .build()
            .map_err(|e| e.to_string())?;
        let shapes = [
            "Arrow",
            "PointingHand",
            "IBeam",
            "Crosshair",
            "OpenHand",
            "ClosedHand",
            "ContextualMenu",
            "OperationNotAllowed",
            "DragCopy",
            "DragLink",
            "ResizeDown",
            "ResizeLeft",
            "ResizeLeftRight",
            "ResizeRight",
            "ResizeUp",
            "ResizeUpDown",
            "IBeamVerticalForVerticalLayout",
        ];
        let mut cursors = serde_json::Map::new();
        for shape in shapes {
            let key = format!("MacOS|{shape}");
            cursors.insert(key.clone(),serde_json::json!({"imagePath":"live-cursor.png","hotspot":{"x":0.0,"y":0.0},"shape":key}));
        }
        let meta:StudioRecordingMeta=serde_json::from_value(serde_json::json!({"segments":[{"display":{"path":"live","fps":60}}],"cursors":cursors,"status":{"status":"Complete"}})).map_err(|e| e.to_string())?;
        let recording = RecordingMeta {
            platform: None,
            project_path: app.path().app_data_dir().map_err(|e| e.to_string())?,
            pretty_name: "实时演示".into(),
            sharing: None,
            inner: RecordingMetaInner::Studio(Box::new(meta.clone())),
            upload: None,
        };
        let constants = RenderVideoConstants::new_with_options(
            RenderOptions {
                screen_size: size,
                camera_size: None,
                preserve_screen_alpha: false,
            },
            recording,
            meta,
        )
        .await
        .map_err(|e| e.to_string())?;
        let mut renderer = FrameRenderer::new(&constants);
        let mut layers = RendererLayers::new(&constants.device, &constants.queue);
        let mut motion = LiveMotion::new(
            size,
            &initial.project.cursor,
            initial.project.screen_movement_spring,
        );
        let mut tick = tokio::time::interval(Duration::from_secs_f64(1.0 / 60.0));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        capturer.start().await.map_err(|e| e.to_string())?;
        let start = Instant::now();
        let device = DeviceState::new();
        let mut ready = Some(ready);
        let mut toggle_epoch = initial.toggle_epoch;
        let mut events = CursorEvents::default();
        let mut pressed = false;
        let mut last_pointer: Option<(XY<f64>, String)> = None;
        let mut frame_times = std::collections::VecDeque::new();
        let mut scroll = unsafe { CGEventSourceCounterForEventType(0, 22) };
        let mut last_monitor_check = Instant::now();
        let mut last_source_check = Instant::now();
        let result = async {
            loop {
                tokio::select! { _=cancel.cancelled()=>break, _=tick.tick()=>{} }
                let current = options.borrow_and_update().clone();
                if last_source_check.elapsed() > Duration::from_secs(1) {
                    last_source_check = Instant::now();
                    if !scap_targets::Display::list()
                        .iter()
                        .any(|display| display.id() == source.id())
                    {
                        return Err("来源显示器已断开，请重新选择来源".into());
                    }
                }
                if current.toggle_epoch.wrapping_sub(toggle_epoch) % 2 == 1 {
                    motion.toggle();
                }
                toggle_epoch = current.toggle_epoch;
                let now_ms = start.elapsed().as_secs_f64() * 1000.0;
                if now_ms > 10_000.0 && rx.borrow().is_none() {
                    return Err("没有收到捕获帧".into());
                }
                let Some((captured, captured_at)) = rx.borrow_and_update().clone() else {
                    continue;
                };
                let (position, shape) = cap_recording::cursor::live_cursor_observation(source)
                    .unwrap_or((XY::new(-1.0, -1.0), None));
                let mouse = device.get_mouse();
                let down = mouse.button_pressed.iter().skip(1).any(|value| *value);
                let scroll_now = unsafe { CGEventSourceCounterForEventType(0, 22) };
                let keyboard_active = !device.get_keys().is_empty() || scroll_now != scroll;
                scroll = scroll_now;
                let visible =
                    (0.0..=1.0).contains(&position.x) && (0.0..=1.0).contains(&position.y);
                motion.advance(
                    now_ms,
                    LivePointerInput {
                        position,
                        pressed: down,
                        keyboard_active,
                        visible,
                    },
                    current.focus_mode,
                    &current.project.cursor,
                    current.zoom_amount,
                    current.idle_seconds,
                );
                if down != pressed {
                    events.clicks.push(CursorClickEvent {
                        time_ms: now_ms,
                        down,
                        cursor_num: 0,
                        active_modifiers: Vec::new(),
                        cursor_id: "MacOS|Arrow".into(),
                    });
                    pressed = down;
                }
                events
                    .clicks
                    .retain(|event| event.time_ms >= now_ms - 2000.0);
                let frames = DecodedSegmentFrames {
                    screen_size: size,
                    screen_frame: Some(captured),
                    camera_frame: None,
                    segment_time: (now_ms / 1000.0) as f32,
                    recording_time: (now_ms / 1000.0) as f32,
                    segment_has_camera: false,
                };
                let id = shape
                    .filter(|shape| shapes.iter().any(|name| shape == &format!("MacOS|{name}")))
                    .unwrap_or_else(|| "MacOS|Arrow".into());
                if visible
                    && !last_pointer
                        .as_ref()
                        .is_some_and(|(last, last_id)| *last == position && last_id == &id)
                {
                    events.moves.push(CursorMoveEvent {
                        time_ms: now_ms,
                        x: position.x,
                        y: position.y,
                        cursor_id: id.clone(),
                        active_modifiers: Vec::new(),
                    });
                    last_pointer = Some((position, id.clone()));
                }
                while events.moves.len() > 1 && events.moves[1].time_ms < now_ms - 4000.0 {
                    events.moves.remove(0);
                }
                frame_times.push_back(((now_ms * 0.06) as u32, Instant::now()));
                while frame_times.len() > 120 {
                    frame_times.pop_front();
                }
                let uniforms = ProjectUniforms::new_live(
                    &constants,
                    LiveRenderInput {
                        project: &current.project,
                        frame_number: (now_ms * 0.06) as u32,
                        fps: 60,
                        output_size: XY::new(current.output_width, current.output_height),
                        events: &events,
                        frames: &frames,
                        motion: &motion,
                        cursor_id: &id,
                    },
                );
                let frame = renderer
                    .render(frames, uniforms, &events, true, &mut layers)
                    .await
                    .map_err(|e| e.to_string())?;
                if let Some(frame) = frame {
                    let age = frame_times
                        .iter()
                        .find(|(number, _)| *number == frame.frame_number)
                        .map_or(captured_at, |(_, instant)| *instant)
                        .elapsed()
                        .as_secs_f64()
                        * 1000.0;
                    output.send_replace(Some(Arc::new(crate::frame_ws::WSFrame {
                        data: frame.data.into(),
                        width: frame.width,
                        height: frame.height,
                        stride: frame.padded_bytes_per_row,
                        frame_number: frame.frame_number,
                        target_time_ns: frame.target_time_ns,
                        format: crate::frame_ws::WSFrameFormat::Rgba,
                        created_at: Instant::now(),
                    })));
                    let mut state = status.lock().unwrap();
                    state.frames += 1;
                    state.processing_ms = age;
                    if state.frames % 120 == 0 {
                        tracing::info!(
                            frames = state.frames,
                            processing_ms = age,
                            "Presentation frame delivery"
                        );
                    }
                    if let Some(sender) = ready.take() {
                        let _ = sender.send(Ok(()));
                    }
                }
                if let Some(target) = &target
                    && last_monitor_check.elapsed() > Duration::from_secs(1)
                {
                    last_monitor_check = Instant::now();
                    let exists = app
                        .available_monitors()
                        .map_err(|e| e.to_string())?
                        .iter()
                        .any(|monitor| {
                            monitor.position() == target.position()
                                && monitor.size() == target.size()
                        });
                    if !exists && !status.lock().unwrap().output_detached {
                        if let Some(window) = app.get_webview_window("presentation-output") {
                            let _ = window.set_always_on_top(false);
                            let _ = window.set_size(tauri::LogicalSize::new(960.0, 540.0));
                            let _ = window.center();
                        }
                        status.lock().unwrap().output_detached = true;
                    }
                }
            }
            Ok(())
        }
        .await;
        let _ = capturer.stop().await;
        if let Some(sender) = ready {
            let _ = sender.send(result.clone());
        }
        result
    }
}

pub fn output_resized(app: &AppHandle, width: u32, height: u32) {
    if width == 0 || height == 0 {
        return;
    }
    let Some(state) = app.try_state::<PresentationState>() else {
        return;
    };
    if let Some(session) = state.session.lock().unwrap().as_ref() {
        let mut options = session.options.borrow().clone();
        if options.output_aspect_ratio.is_some() {
            return;
        }
        let size = output_size(
            options.output_resolution,
            f64::from(width) / f64::from(height),
        );
        if (320..=7680).contains(&size.0)
            && (240..=4320).contains(&size.1)
            && (options.output_width, options.output_height) != size
        {
            (options.output_width, options.output_height) = size;
            session.options.send_replace(options.clone());
            let _ = app.emit("presentation-options-changed", &options);
        }
    }
}

#[cfg(debug_assertions)]
pub fn run_smoke(app: AppHandle) {
    static STARTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    let Some(path) = std::env::var_os("JIANKU_PRESENTATION_SMOKE_OUTPUT") else {
        return;
    };
    if STARTED.swap(true, std::sync::atomic::Ordering::AcqRel) {
        return;
    }
    crate::spawn_on_runtime(async move {
        let result = async {
            show_presentation(app.clone()).await?;
            let mut options = get_presentation_setup(app.clone())?.options;
            options.output_monitor = None;
            options.focus_mode = LiveFocusMode::Automatic;
            let original_padding = options.project.background.padding;
            options.output_width = 1920; options.output_height = 1080;
            let initial = start_presentation(app.clone(), options.clone()).await?;
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            let playing = get_presentation_status(app.clone());
            options.project.background.padding = 12.0;
            update_presentation(app.clone(), options.clone())?;
            toggle_presentation_focus(app.clone())?;
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            toggle_presentation_focus(app.clone())?;
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            let edited = get_presentation_status(app.clone());
            options.project.background.padding = original_padding;
            update_presentation(app.clone(), options.clone())?;
            stop_presentation(app.clone()).await?;
            let stopped = get_presentation_status(app.clone());
            let restarted = start_presentation(app.clone(), options).await?;
            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
            let final_status = get_presentation_status(app.clone());
            if !initial.active || playing.frames < 30 || edited.frames <= playing.frames || stopped.active || !restarted.active || final_status.frames < 30 { return Err("演示闭环检查失败".to_string()); }
            Ok(serde_json::json!({"initial":initial,"playing":playing,"edited":edited,"stopped":stopped,"restarted":restarted,"final":final_status,"userFramesSaved":false}))
        }.await;
        let json = match result {
            Ok(value) => value,
            Err(error) => serde_json::json!({"error":error,"userFramesSaved":false}),
        };
        let _ = std::fs::write(path, serde_json::to_vec_pretty(&json).unwrap());
    });
}

#[cfg(test)]
mod output_aspect_tests {
    use super::*;

    #[test]
    fn quality_reference_preserves_ratios_and_even_dimensions_without_stretching() {
        for resolution in [1280, 1920, 2560, 3840] {
            for aspect in [
                AspectRatio::Wide,
                AspectRatio::Vertical,
                AspectRatio::Square,
                AspectRatio::WideScreen,
                AspectRatio::TallScreen,
                AspectRatio::Classic,
                AspectRatio::Tall,
                AspectRatio::Landscape,
                AspectRatio::Portrait,
                AspectRatio::Photo,
                AspectRatio::Social,
                AspectRatio::Ultrawide,
                AspectRatio::Cinema,
            ] {
                let (width, height) = output_size(resolution, aspect.ratio());
                assert_eq!(width % 2, 0);
                assert_eq!(height % 2, 0);
                assert!(width <= resolution && height <= resolution);
                assert!((f64::from(width) / f64::from(height) - aspect.ratio()).abs() < 0.006);
            }
        }
        assert_eq!(output_size(1920, 16.0 / 10.0), (1728, 1080));
        assert_eq!(output_size(1920, 1.0), (1080, 1080));
        assert_eq!(output_size(1920, 9.0 / 16.0), (1080, 1920));
    }
}
