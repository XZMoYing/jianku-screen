use base64::Engine;
use cap_project::{
    CursorEvents, ProjectConfiguration, RecordingMeta, RecordingMetaInner, StudioRecordingMeta, XY,
};
use cap_rendering::{
    DecodedFrame, DecodedSegmentFrames, FrameRenderer, ProjectUniforms, RenderOptions,
    RenderVideoConstants, RendererLayers, SharedWgpuDevice, ZoomTransformTimeline,
};
use std::collections::HashMap;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use tokio::sync::watch;
use tokio::sync::{Mutex, OnceCell};
use tokio_util::sync::CancellationToken;

struct PreviewResources {
    constants: RenderVideoConstants,
    layers: Mutex<RendererLayers>,
    source: Arc<Vec<u8>>,
    camera: Arc<Vec<u8>>,
    events: CursorEvents,
}
static PREVIEW: OnceCell<PreviewResources> = OnceCell::const_new();

async fn resources(app: &AppHandle) -> Result<&'static PreviewResources, String> {
    PREVIEW.get_or_try_init(|| async {
        let gpu = crate::gpu_context::get_shared_gpu().await.ok_or("无法初始化画面预览")?;
        let root = app.path().app_cache_dir().map_err(|e|e.to_string())?.join("capture-preview");
        std::fs::create_dir_all(&root).map_err(|e|e.to_string())?;
        std::fs::write(root.join("preview-cursor.png"), include_bytes!("../assets/capture-cursor-preview.png")).map_err(|e|e.to_string())?;
        let meta: StudioRecordingMeta = serde_json::from_value(serde_json::json!({
            "segments":[{"display":{"path":"preview","fps":60},"camera":{"path":"camera-preview","fps":60}}],
            "cursors":{"MacOS|Arrow":{"imagePath":"preview-cursor.png","hotspot":{"x":0.1666666667,"y":0.12},"shape":"MacOS|Arrow"}},
            "status":{"status":"Complete"}
        })).map_err(|error| error.to_string())?;
        let recording = RecordingMeta {
            platform: None, project_path: root,
            pretty_name: "画面示意".into(), sharing: None, upload: None,
            inner: RecordingMetaInner::Studio(Box::new(meta.clone())),
        };
        let constants = RenderVideoConstants::from_shared_device(SharedWgpuDevice {
            instance: (*gpu.instance).clone(), adapter: (*gpu.adapter).clone(), device: (*gpu.device).clone(),
            queue: (*gpu.queue).clone(), is_software_adapter: gpu.is_software_adapter,
        }, RenderOptions { screen_size: XY::new(1280,800), camera_size: Some(XY::new(240,240)), preserve_screen_alpha: false }, meta, recording, gpu.background_cache.clone());
        let layers = Mutex::new(RendererLayers::new_with_options(&constants.device, &constants.queue, constants.is_software_adapter));
        let source = image::load_from_memory(include_bytes!("../assets/capture-preview.png")).map_err(|e| e.to_string())?.to_rgba8().into_raw();
        let events = CursorEvents {
            moves: (0..=360).map(|i| {
                let t = f64::from(i) / 60.0;
                cap_project::CursorMoveEvent { time_ms: t*1000.0, x: 0.57 + 0.18*(t*std::f64::consts::TAU/6.0).sin(), y: 0.55 + 0.13*(t*std::f64::consts::TAU/3.0).cos(), cursor_id: "MacOS|Arrow".into(), active_modifiers: Vec::new() }
            }).collect(),
            clicks: [1.0,3.0,5.0].into_iter().flat_map(|t| [true,false].map(move |down| cap_project::CursorClickEvent { time_ms: (t + if down {0.0} else {0.12})*1000.0, down, cursor_num:0, active_modifiers:Vec::new(),cursor_id:"MacOS|Arrow".into() })).collect(),
            ..Default::default()
        };
        let camera = image::load_from_memory(include_bytes!("../assets/capture-camera-preview.png")).map_err(|e|e.to_string())?.to_rgba8().into_raw();
        Ok(PreviewResources { constants, layers, source: Arc::new(source), camera: Arc::new(camera), events })
    }).await
}

#[tauri::command]
#[specta::specta]
pub async fn render_capture_preview(
    app: AppHandle,
    mut config: ProjectConfiguration,
    time: f64,
) -> Result<String, String> {
    config.timeline = None;
    config.clips.clear();
    config.validate().map_err(|e| e.to_string())?;
    let resources = resources(&app).await?;
    let mut layers = resources.layers.lock().await;
    let constants = &resources.constants;
    let time = if time.is_finite() {
        time.clamp(0.0, 6.0)
    } else {
        0.0
    };
    let mut zoom = ZoomTransformTimeline::from_project(
        &config,
        &resources.events,
        6.0,
        constants.options.screen_size,
    );
    let mut renderer = FrameRenderer::new(constants);
    let frame = render_frame(
        resources,
        &mut renderer,
        &mut layers,
        &config,
        time,
        &mut zoom,
    )
    .await?;
    let mut bytes = Vec::with_capacity(12 + frame.data.len());
    bytes.extend_from_slice(&frame.width.to_le_bytes());
    bytes.extend_from_slice(&frame.height.to_le_bytes());
    bytes.extend_from_slice(&frame.padded_bytes_per_row.to_le_bytes());
    bytes.extend_from_slice(&frame.data);
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

async fn render_frame(
    resources: &PreviewResources,
    renderer: &mut FrameRenderer<'_>,
    layers: &mut RendererLayers,
    config: &ProjectConfiguration,
    time: f64,
    zoom: &mut ZoomTransformTimeline,
) -> Result<cap_rendering::RenderedFrame, String> {
    let constants = &resources.constants;
    let background_time = time;
    let time = time.rem_euclid(6.0);
    let frames = DecodedSegmentFrames {
        screen_size: constants.options.screen_size,
        screen_frame: Some(DecodedFrame::new_with_arc(
            resources.source.clone(),
            1280,
            800,
        )),
        camera_frame: Some(DecodedFrame::new_with_arc(
            resources.camera.clone(),
            240,
            240,
        )),
        segment_time: time as f32,
        recording_time: time as f32,
        segment_has_camera: true,
    };
    zoom.ensure_precomputed_until((time + 1.0 / 60.0) as f32);
    let (width, height) = ProjectUniforms::get_base_size(&constants.options, config);
    let scale = (960.0 / f64::from(width.max(height))).min(1.0);
    let output = XY::new(
        ((f64::from(width) * scale) as u32).max(2),
        ((f64::from(height) * scale) as u32).max(2),
    );
    let mut uniforms = ProjectUniforms::new(
        constants,
        config,
        (time * 60.0) as u32,
        60,
        output,
        &resources.events,
        &frames,
        time,
        zoom,
    );
    uniforms.frame_number = (background_time * 60.0) as u32;
    let frame = renderer
        .render_immediate(frames, uniforms, &resources.events, true, layers)
        .await
        .map_err(|e| e.to_string())?;
    Ok(frame)
}

#[derive(Clone)]
struct PreviewSettings {
    config: ProjectConfiguration,
    playing: bool,
}
struct PreviewSession {
    settings: watch::Sender<PreviewSettings>,
    cancel: CancellationToken,
}
#[derive(Default)]
pub struct CapturePreviewState(Mutex<HashMap<String, PreviewSession>>);

fn validated(mut config: ProjectConfiguration) -> Result<ProjectConfiguration, String> {
    config.timeline = None;
    config.clips.clear();
    config.validate().map_err(|e| e.to_string())?;
    Ok(config)
}

#[tauri::command]
#[specta::specta]
pub async fn start_capture_preview(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, CapturePreviewState>,
    config: ProjectConfiguration,
    playing: bool,
) -> Result<u16, String> {
    let resources = resources(&app).await?;
    let config = validated(config)?;
    let (settings, mut changes) = watch::channel(PreviewSettings { config, playing });
    let (output, frames) = watch::channel(None);
    let subscribers = Arc::new(AtomicUsize::new(0));
    let (port, cancel) = crate::frame_ws::create_watch_frame_ws(frames, subscribers.clone()).await;
    let session = PreviewSession {
        settings,
        cancel: cancel.clone(),
    };
    if let Some(previous) = state.0.lock().await.insert(window.label().into(), session) {
        previous.cancel.cancel();
    }
    tokio::spawn(async move {
        let mut renderer = FrameRenderer::new(&resources.constants);
        let mut layers = RendererLayers::new_with_options(
            &resources.constants.device,
            &resources.constants.queue,
            resources.constants.is_software_adapter,
        );
        let mut current = changes.borrow_and_update().clone();
        let mut zoom = ZoomTransformTimeline::from_project(
            &current.config,
            &resources.events,
            6.0,
            resources.constants.options.screen_size,
        );
        let mut interval = tokio::time::interval(Duration::from_secs_f64(1.0 / 60.0));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut started = Instant::now();
        let mut dirty = true;
        let mut sequence = 0;
        let mut missing_since = Instant::now();
        loop {
            tokio::select! {
                _ = cancel.cancelled() => break,
                _ = interval.tick() => {},
            }
            if changes.has_changed().unwrap_or(false) {
                let next = changes.borrow_and_update().clone();
                if !current.playing && next.playing {
                    started = Instant::now();
                }
                zoom = ZoomTransformTimeline::from_project(
                    &next.config,
                    &resources.events,
                    6.0,
                    resources.constants.options.screen_size,
                );
                current = next;
                dirty = true;
            }
            if subscribers.load(Ordering::Acquire) == 0 {
                if missing_since.elapsed() > Duration::from_secs(30) {
                    break;
                }
                continue;
            }
            missing_since = Instant::now();
            if !dirty && !current.playing {
                continue;
            }
            let time = if current.playing {
                started.elapsed().as_secs_f64()
            } else {
                0.7
            };
            layers.use_realtime_background(current.playing);
            let created_at = Instant::now();
            let frame = tokio::select! {
                _ = cancel.cancelled() => break,
                result = render_frame(resources, &mut renderer, &mut layers, &current.config, time, &mut zoom) => result,
            };
            match frame {
                Ok(frame) => {
                    sequence += 1;
                    let _ = output.send_replace(Some(Arc::new(
                        crate::frame_ws::WSFrame {
                            data: frame.data.into(),
                            width: frame.width,
                            height: frame.height,
                            stride: frame.padded_bytes_per_row,
                            frame_number: sequence,
                            target_time_ns: 0,
                            format: crate::frame_ws::WSFrameFormat::Rgba,
                            created_at,
                        }
                        .into_packed(),
                    )));
                    dirty = false;
                }
                Err(error) => {
                    tracing::error!(%error, "Capture preview render failed");
                    break;
                }
            }
        }
        cancel.cancel();
    });
    Ok(port)
}

#[tauri::command]
#[specta::specta]
pub async fn update_capture_preview(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, CapturePreviewState>,
    config: ProjectConfiguration,
    playing: bool,
) -> Result<(), String> {
    let config = validated(config)?;
    let sessions = state.0.lock().await;
    let session = sessions.get(window.label()).ok_or("画面预览尚未启动")?;
    session
        .settings
        .send(PreviewSettings { config, playing })
        .map_err(|_| "画面预览已停止".to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn stop_capture_preview(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, CapturePreviewState>,
) -> Result<(), String> {
    if let Some(session) = state.0.lock().await.remove(window.label()) {
        session.cancel.cancel();
    }
    Ok(())
}
