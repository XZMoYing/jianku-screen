use cap_editor::{
    AudioOutput, EditorFrameFormat, EditorFrameOutput, EditorInstance, EditorStartupInputs,
    PlaybackHandle, PlaybackTelemetry, PlaybackTelemetryEvent,
};
use cap_project::{ProjectConfiguration, RecordingMeta, XY};
use serde::Serialize;
use std::{
    io::Write,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

#[derive(Clone, Serialize)]
struct AudioPoint {
    seconds: f64,
    callback_seconds: f64,
    mean: f64,
    phase: Option<usize>,
}

#[derive(Clone, Serialize)]
struct VideoPoint {
    seconds: f64,
    frame: u32,
    center: f64,
    phase: Option<usize>,
    expected_phase: usize,
    source_time: f64,
}

#[derive(Serialize)]
struct Window {
    name: String,
    target_frame: u32,
    frames: usize,
    source_checks: usize,
    audio_video_offsets_ms: Vec<f64>,
}

struct Probe {
    fps: u32,
    replay_rounds: u32,
    telemetry_rx: tokio::sync::mpsc::UnboundedReceiver<(Instant, PlaybackTelemetryEvent)>,
    editor: Arc<EditorInstance>,
    project: ProjectConfiguration,
    epoch: Instant,
    audio: Arc<Mutex<Vec<AudioPoint>>>,
    video: Arc<Mutex<Vec<VideoPoint>>>,
    windows: Vec<Window>,
    natural_end_verified: bool,
}

fn phase(value: f64, levels: &[f64; 4], tolerance: f64) -> Option<usize> {
    levels
        .iter()
        .enumerate()
        .min_by(|(_, a), (_, b)| (value - **a).abs().total_cmp(&(value - **b).abs()))
        .filter(|(_, level)| (value - **level).abs() < tolerance)
        .map(|(index, _)| index)
}

impl Probe {
    async fn new(path: PathBuf, fps: u32, replay_rounds: u32, trace: bool) -> Result<Self, String> {
        let marker: serde_json::Value = serde_json::from_slice(
            &std::fs::read(path.join(".jianku-long-project-fixture.json")).map_err(|error| {
                format!("Only generated long-project fixtures are supported: {error}")
            })?,
        )
        .map_err(|error| error.to_string())?;
        if marker["kind"] != "long-project-check" || marker["version"] != 1 {
            return Err("Unsupported verification fixture".into());
        }
        let project = RecordingMeta::load_for_project(&path)
            .map_err(|error| error.to_string())?
            .project_config();
        let duration = project
            .timeline
            .as_ref()
            .ok_or("Missing timeline")?
            .duration();
        if !duration.is_finite() || duration < 10.0 {
            return Err("Expected a finite timeline of at least 10 seconds".into());
        }
        let epoch = Instant::now();
        let audio = Arc::new(Mutex::new(Vec::new()));
        let video = Arc::new(Mutex::new(Vec::new()));
        let output = Arc::new(AudioOutput::new_headless(Box::new({
            let audio = audio.clone();
            move |samples, deadline| {
                let callback_seconds = epoch.elapsed().as_secs_f64();
                let mean = samples.iter().map(|sample| f64::from(*sample)).sum::<f64>()
                    / samples.len() as f64;
                let levels = [5000.0, 9000.0, 13000.0, 17000.0]
                    .map(|sample| sample / 32768.0 * std::f64::consts::FRAC_1_SQRT_2);
                audio.lock().unwrap().push(AudioPoint {
                    seconds: deadline.saturating_duration_since(epoch).as_secs_f64(),
                    callback_seconds,
                    mean,
                    phase: phase(mean, &levels, 0.004),
                });
            }
        })));
        let (telemetry, telemetry_rx) = PlaybackTelemetry::timed_channel();
        let editor = EditorInstance::new_with_startup_inputs(
            path,
            |_| {},
            Box::new({
                let video = video.clone();
                let project = project.clone();
                move |output, _| {
                    let EditorFrameOutput::Rgba(frame) = output else {
                        return;
                    };
                    let output_time = f64::from(frame.frame_number) / f64::from(fps);
                    let Some((source_time, _)) = project.get_segment_time(output_time) else {
                        return;
                    };
                    let offset = (frame.height / 2) as usize * frame.padded_bytes_per_row as usize
                        + (frame.width / 2) as usize * 4;
                    let center = frame.data[offset..offset + 3]
                        .iter()
                        .map(|value| f64::from(*value))
                        .sum::<f64>()
                        / 3.0;
                    let levels = [40.0, 80.0, 120.0, 160.0]
                        .map(|value| ((value - 16.0) * 255.0 / 219.0_f64).clamp(0.0, 255.0));
                    video.lock().unwrap().push(VideoPoint {
                        seconds: epoch.elapsed().as_secs_f64(),
                        frame: frame.frame_number,
                        center,
                        phase: phase(center, &levels, 3.0),
                        expected_phase: source_time.floor().rem_euclid(4.0) as usize,
                        source_time,
                    });
                }
            }),
            None,
            EditorFrameFormat::Rgba,
            output,
            EditorStartupInputs {
                playback_telemetry: trace.then_some(telemetry),
                ..Default::default()
            },
        )
        .await?;
        Ok(Self {
            fps,
            replay_rounds,
            telemetry_rx,
            editor,
            project,
            epoch,
            audio,
            video,
            windows: Vec::new(),
            natural_end_verified: false,
        })
    }

    async fn window(&mut self, name: &str, target: u32) -> Result<(), String> {
        let since = self.epoch.elapsed().as_secs_f64();
        tokio::time::sleep(Duration::from_millis(3100)).await;
        let until = self.epoch.elapsed().as_secs_f64();
        let video: Vec<_> = self
            .video
            .lock()
            .unwrap()
            .iter()
            .filter(|point| point.seconds >= since + 0.4 && point.seconds < until)
            .cloned()
            .collect();
        let audio: Vec<_> = self
            .audio
            .lock()
            .unwrap()
            .iter()
            .filter(|point| point.seconds >= since + 0.4 && point.seconds < until)
            .cloned()
            .collect();
        let mut source_checks = 0;
        for point in &video {
            if point.frame < target || point.frame > target + self.fps * 5 {
                return Err(format!(
                    "{name}: stale timeline frame {} for target {target}",
                    point.frame
                ));
            }
            let fraction = point.source_time.rem_euclid(1.0);
            if fraction > 0.12 && fraction < 0.88 {
                source_checks += 1;
                if point.phase != Some(point.expected_phase) {
                    return Err(format!(
                        "{name}: wrong source at frame {}, time {}, center {}, expected phase {}",
                        point.frame, point.source_time, point.center, point.expected_phase
                    ));
                }
            }
        }
        if source_checks < 15 {
            return Err(format!(
                "{name}: only {source_checks} source-correct samples"
            ));
        }
        let audio_edges = edges(audio.iter().map(|point| (point.seconds, point.phase)));
        let video_edges = edges(video.iter().map(|point| (point.seconds, point.phase)));
        let mut offsets = Vec::new();
        for (time, phase) in video_edges {
            let nearest = audio_edges
                .iter()
                .filter(|(_, audio_phase)| *audio_phase == phase)
                .min_by(|(a, _), (b, _)| (time - a).abs().total_cmp(&(time - b).abs()))
                .ok_or_else(|| format!("{name}: no matching audio phase transition {phase}"))?;
            let offset = (time - nearest.0) * 1000.0;
            if offset.abs() > 150.0 {
                return Err(format!(
                    "{name}: native audio/video transition offset {offset:.2}ms"
                ));
            }
            offsets.push(offset);
        }
        if offsets.is_empty() {
            return Err(format!("{name}: no audio/video transition pairs"));
        }
        self.windows.push(Window {
            name: name.into(),
            target_frame: target,
            frames: video.len(),
            source_checks,
            audio_video_offsets_ms: offsets,
        });
        Ok(())
    }

    async fn pause(&self, handle: &PlaybackHandle) -> Result<(), String> {
        handle.stop();
        let mut active = self.editor.playback_watch();
        tokio::time::timeout(Duration::from_secs(5), async {
            while *active.borrow_and_update() {
                active.changed().await.map_err(|error| error.to_string())?;
            }
            Ok::<_, String>(())
        })
        .await
        .map_err(|error| error.to_string())?
    }

    async fn rewind_preview(&self) -> Result<(), String> {
        let since = self.epoch.elapsed().as_secs_f64();
        self.editor
            .preview_tx
            .send_replace(Some((0, self.fps, XY::new(1280, 720))));
        tokio::time::timeout(Duration::from_secs(8), async {
            loop {
                if self.video.lock().unwrap().iter().any(|point| {
                    point.seconds >= since && point.frame == 0 && point.phase == Some(0)
                }) {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .map_err(|error| format!("Rewind preview did not render: {error}"))
    }

    async fn run(&mut self) -> Result<(), String> {
        let duration = self
            .project
            .timeline
            .as_ref()
            .ok_or("Missing timeline")?
            .duration();
        let handle = self
            .editor
            .start_playback_with_handle(self.fps, XY::new(1280, 720), Some(7))
            .await
            .map_err(|error| format!("{error:?}"))?;
        self.window("initial", 7).await?;
        for (name, seconds) in [
            ("middle-boundary", duration / 2.0 - 0.6),
            ("tail", duration - 5.77),
        ] {
            let frame = (seconds * f64::from(self.fps)).round() as u32;
            if !self.editor.seek_playback(frame).await {
                return Err(format!("{name}: seek rejected"));
            }
            self.window(name, frame).await?;
        }
        self.pause(&handle).await?;
        self.rewind_preview().await?;
        for round in 0..self.replay_rounds {
            let replay = self
                .editor
                .start_playback_with_handle(self.fps, XY::new(1280, 720), Some(7))
                .await
                .map_err(|error| format!("{error:?}"))?;
            self.window(&format!("rewind-replay-{round}"), 7).await?;
            self.pause(&replay).await?;
            self.rewind_preview().await?;
        }
        let final_start = ((duration - 1.3) * f64::from(self.fps)).floor() as u32;
        let _final_playback = self
            .editor
            .start_playback_with_handle(self.fps, XY::new(1280, 720), Some(final_start))
            .await
            .map_err(|error| format!("{error:?}"))?;
        let mut active = self.editor.playback_watch();
        tokio::time::timeout(Duration::from_secs(8), async {
            while *active.borrow_and_update() {
                active.changed().await.map_err(|error| error.to_string())?;
            }
            Ok::<_, String>(())
        })
        .await
        .map_err(|error| format!("Natural end did not stop: {error}"))??;
        let minimum = (duration * f64::from(self.fps)).ceil() as u32 - 3;
        if !self
            .video
            .lock()
            .unwrap()
            .iter()
            .any(|point| point.frame >= minimum)
        {
            return Err("Natural end did not render the final frames".into());
        }
        self.natural_end_verified = true;
        Ok(())
    }
}

fn edges(points: impl Iterator<Item = (f64, Option<usize>)>) -> Vec<(f64, usize)> {
    let mut previous = None;
    let mut result = Vec::new();
    for (time, current) in points {
        if let Some(current) = current {
            if previous.is_some_and(|previous| previous != current) {
                result.push((time, current));
            }
            previous = Some(current);
        }
    }
    result
}

async fn run() -> Result<(), String> {
    let args: Vec<_> = std::env::args().collect();
    let path = args
        .get(1)
        .ok_or("Usage: long-project-check GENERATED_PROJECT NEW_OUTPUT_JSON [30|60] [REPLAY_ROUNDS] [trace]")?;
    let output = args.get(2).ok_or("Missing report path")?;
    if PathBuf::from(output).exists() {
        return Err("Choose a new output report path".into());
    }
    ffmpeg::init().map_err(|error| error.to_string())?;
    let fps = match args.get(3) {
        Some(value) => value.parse::<u32>().map_err(|error| error.to_string())?,
        None => 60,
    };
    if ![30, 60].contains(&fps) {
        return Err("Expected 30 or 60 fps".into());
    }
    let replay_rounds = args
        .get(4)
        .map(|value| value.parse::<u32>())
        .transpose()
        .map_err(|error| error.to_string())?
        .unwrap_or(3);
    if !(1..=20).contains(&replay_rounds) {
        return Err("Expected 1 to 20 replay rounds".into());
    }
    let trace = match args.get(5).map(String::as_str) {
        None => false,
        Some("trace") => true,
        Some(_) => return Err("Expected trace option".into()),
    };
    let startup = Instant::now();
    let mut probe = Probe::new(PathBuf::from(path), fps, replay_rounds, trace).await?;
    let startup_ms = startup.elapsed().as_secs_f64() * 1000.0;
    let result = probe.run().await;
    probe.editor.dispose().await;
    let mut timings = Vec::new();
    while let Ok((emitted, event)) = probe.telemetry_rx.try_recv() {
        timings.push(timing_point(
            emitted.saturating_duration_since(probe.epoch).as_secs_f64(),
            event,
        ));
    }
    let report = serde_json::json!({
        "fps": fps, "replayRounds": replay_rounds, "traceEnabled": trace, "timings": timings, "passed": result.is_ok(), "error": result.as_ref().err(), "startupMs": startup_ms,
        "naturalEndVerified": probe.natural_end_verified, "windows": probe.windows, "video": *probe.video.lock().unwrap(), "audio": *probe.audio.lock().unwrap(),
        "scope": "Sampled windows of long timelines in native EditorInstance/GPU and production headless audio callback; not full-duration playback, physical audio or WebView display acceptance."
    });
    let bytes = serde_json::to_vec_pretty(&report).map_err(|error| error.to_string())?;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(output)
        .map_err(|error| error.to_string())?;
    file.write_all(&bytes).map_err(|error| error.to_string())?;
    result
}

fn timing_point(seconds: f64, event: PlaybackTelemetryEvent) -> serde_json::Value {
    let mut point = match event {
        PlaybackTelemetryEvent::FrameSubmitted {
            frame_number,
            source,
            schedule_overshoot,
            frame_acquire_duration,
            uniforms_duration,
            submit_duration,
            prefetch_buffer_len,
            total_frames_skipped,
        } => serde_json::json!({
            "stage":"submitted", "frame":frame_number,"source":format!("{source:?}"),
            "overshootMs":schedule_overshoot.as_secs_f64()*1000.0,"acquireMs":frame_acquire_duration.as_secs_f64()*1000.0,
            "uniformsMs":uniforms_duration.as_secs_f64()*1000.0,"submitMs":submit_duration.as_secs_f64()*1000.0,
            "prefetchFrames":prefetch_buffer_len,"skipped":total_frames_skipped
        }),
        PlaybackTelemetryEvent::RendererFrame {
            frame_number,
            input_frame_number,
            queue_wait,
            drain_duration,
            flush_duration,
            render_duration,
            render_stage_timings: t,
            callback_duration,
            drained_count,
            ..
        } => serde_json::json!({
            "stage":"rendered","frame":frame_number,"inputFrame":input_frame_number,"queueMs":queue_wait.as_secs_f64()*1000.0,
            "drainMs":drain_duration.as_secs_f64()*1000.0,"flushMs":flush_duration.as_secs_f64()*1000.0,"renderMs":render_duration.as_secs_f64()*1000.0,
            "prepareMs":t.prepare_duration.as_secs_f64()*1000.0,"backgroundMs":t.background_prepare_duration.as_secs_f64()*1000.0,
            "backgroundBlurMs":t.background_blur_prepare_duration.as_secs_f64()*1000.0,"displayMs":t.display_prepare_duration.as_secs_f64()*1000.0,
            "cameraMs":t.camera_prepare_duration.as_secs_f64()*1000.0,"layersMs":t.layer_render_duration.as_secs_f64()*1000.0,
            "finishMs":t.finish_duration.as_secs_f64()*1000.0,"finishWaitMs":t.finish_wait_previous_duration.as_secs_f64()*1000.0,
            "submitReadbackMs":t.finish_submit_readback_duration.as_secs_f64()*1000.0,"immediateFlushMs":t.immediate_flush_duration.as_secs_f64()*1000.0,
            "callbackMs":callback_duration.as_secs_f64()*1000.0,"drainedCount":drained_count
        }),
        PlaybackTelemetryEvent::FrameSkipped {
            frame_number,
            skipped,
            reason,
            prefetch_buffer_len,
        } => {
            serde_json::json!({"stage":"skipped","frame":frame_number,"count":skipped,"reason":format!("{reason:?}"),"prefetchFrames":prefetch_buffer_len})
        }
        other => serde_json::json!({"stage":"control","event":format!("{other:?}")}),
    };
    point["seconds"] = serde_json::json!(seconds);
    point
}

fn main() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use std::ffi::c_void;
        #[link(name = "CoreFoundation", kind = "framework")]
        unsafe extern "C" {
            static kCFRunLoopDefaultMode: *const c_void;
            fn CFRunLoopRunInMode(
                mode: *const c_void,
                seconds: f64,
                return_after_source: u8,
            ) -> i32;
        }
        #[link(name = "objc")]
        unsafe extern "C" {
            fn objc_autoreleasePoolPush() -> *mut c_void;
            fn objc_autoreleasePoolPop(pool: *mut c_void);
        }
        // AVPlayer work is dispatched to the main queue; blocking it on Tokio
        // silently measures wallpaper timeouts and fallback instead of the app path.
        let worker = std::thread::spawn(|| {
            tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .map_err(|error| error.to_string())?
                .block_on(run())
        });
        while !worker.is_finished() {
            unsafe {
                let pool = objc_autoreleasePoolPush();
                CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.01, 0);
                objc_autoreleasePoolPop(pool);
            }
            std::thread::sleep(Duration::from_millis(1));
        }
        worker
            .join()
            .map_err(|_| "Verification worker panicked".to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|error| error.to_string())?
        .block_on(run())
}
