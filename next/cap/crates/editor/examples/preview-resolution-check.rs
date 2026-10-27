use cap_editor::{
    AudioOutput, EditorFrameFormat, EditorFrameOutput, EditorInstance, EditorStartupInputs,
    PlaybackHandle, PlaybackTelemetry, PlaybackTelemetryEvent,
};
use cap_project::{AspectRatio, Crop, ProjectConfiguration, XY};
use cap_rendering::preview_resolution::{
    EditorPreviewQuality, PreviewCanvasConfiguration, PreviewResolutionOption, preview_resolutions,
};
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

#[derive(Clone, Serialize)]
struct FramePoint {
    frame: u32,
    width: u32,
    height: u32,
    bytes: usize,
    row_bytes: u32,
}

struct PlaybackGuard(PlaybackHandle);
impl Drop for PlaybackGuard {
    fn drop(&mut self) {
        self.0.stop();
    }
}

async fn observe(
    handle: &PlaybackHandle,
    points: &Mutex<Vec<FramePoint>>,
    choice: &PreviewResolutionOption,
) -> Result<FramePoint, String> {
    let previous = points.lock().unwrap().len();
    if !handle.set_resolution_base(choice.resolution_base) {
        return Err("Playback stopped before resolution update".into());
    }
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        {
            let frames = points.lock().unwrap();
            if let Some(point) = frames[previous..]
                .iter()
                .filter(|point| {
                    point.width == choice.output_size.x && point.height == choice.output_size.y
                })
                .nth(1)
            {
                return Ok(point.clone());
            }
        }
        if Instant::now() >= deadline {
            return Err(format!(
                "Did not observe {:?} at {:?}",
                choice.quality, choice.output_size
            ));
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

async fn run() -> Result<(), String> {
    let args: Vec<_> = std::env::args().collect();
    let project_path = PathBuf::from(args.get(1).ok_or("Expected an owned fixture path")?);
    let output_path = PathBuf::from(args.get(2).ok_or("Expected a new JSON report path")?);
    if output_path.exists() {
        return Err("Existing reports are never replaced".into());
    }
    let marker: serde_json::Value = serde_json::from_slice(
        &std::fs::read(project_path.join(".jianku-preview-resolution-fixture.json"))
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    if marker != serde_json::json!({"kind":"jianku-preview-resolution","version":1}) {
        return Err("Only generated verification fixtures are accepted".into());
    }
    ffmpeg::init().map_err(|error| error.to_string())?;
    let points = Arc::new(Mutex::new(Vec::<FramePoint>::new()));
    let audio_samples = Arc::new(AtomicU64::new(0));
    let output = Arc::new(AudioOutput::new_headless(Box::new({
        let samples = audio_samples.clone();
        move |data, _| {
            samples.fetch_add(data.len() as u64, Ordering::Relaxed);
        }
    })));
    let (telemetry, mut events) = PlaybackTelemetry::timed_channel();
    let editor = EditorInstance::new_with_startup_inputs(
        project_path,
        |_| {},
        Box::new({
            let points = points.clone();
            move |output, _| {
                if let EditorFrameOutput::Rgba(frame) = output {
                    points.lock().unwrap().push(FramePoint {
                        frame: frame.frame_number,
                        width: frame.width,
                        height: frame.height,
                        bytes: frame.data.len(),
                        row_bytes: frame.padded_bytes_per_row,
                    });
                }
            }
        }),
        None,
        EditorFrameFormat::Rgba,
        output,
        EditorStartupInputs {
            playback_telemetry: Some(telemetry),
            ..Default::default()
        },
    )
    .await?;
    let constants = &editor.render_constants;
    let max_dimension = constants.device.limits().max_texture_dimension_2d;
    let mut project: ProjectConfiguration = editor.project_config.1.borrow().clone();
    let catalogue = preview_resolutions(
        &constants.options,
        &PreviewCanvasConfiguration::from(&project),
        max_dimension,
    )?;
    let initial = catalogue
        .iter()
        .find(|choice| choice.quality == EditorPreviewQuality::P144 && choice.available)
        .ok_or("The fixture must support 144p")?;
    let handle = PlaybackGuard(
        editor
            .start_playback_with_handle(60, initial.resolution_base, None)
            .await
            .map_err(|error| format!("{error:?}"))?,
    );
    let mut observations = Vec::new();
    for choice in catalogue.iter().filter(|choice| choice.available) {
        let point = observe(&handle.0, &points, choice).await?;
        observations.push(serde_json::json!({"case":"quality", "choice":choice,"observed":point}));
    }
    for (name, aspect, crop) in [
        ("portrait", Some(AspectRatio::Vertical), None),
        ("square", Some(AspectRatio::Square), None),
        (
            "small-crop",
            None,
            Some(Crop {
                position: XY::new(0, 0),
                size: XY::new(320, 240),
            }),
        ),
    ] {
        project.aspect_ratio = aspect;
        project.background.crop = crop;
        project.background.padding = 0.0;
        editor
            .project_config
            .0
            .send(project.clone())
            .map_err(|error| error.to_string())?;
        let choices = preview_resolutions(
            &constants.options,
            &PreviewCanvasConfiguration::from(&project),
            max_dimension,
        )?;
        let choice = choices
            .iter()
            .find(|v| v.quality == EditorPreviewQuality::P720 && v.available)
            .or_else(|| {
                choices
                    .iter()
                    .find(|v| v.quality == EditorPreviewQuality::Original)
            })
            .unwrap();
        let point = observe(&handle.0, &points, choice).await?;
        observations.push(serde_json::json!({"case":name, "choice":choice,"observed":point}));
    }
    handle.0.stop();
    tokio::time::sleep(Duration::from_millis(150)).await;
    let frames = points.lock().unwrap().clone();
    if frames.windows(2).any(|pair| pair[1].frame < pair[0].frame)
        || frames.iter().any(|point| {
            point.bytes < point.row_bytes as usize * point.height as usize
                || point.row_bytes < point.width * 4
        })
    {
        return Err("Rendered frames restarted or have an invalid pixel buffer".into());
    }
    let mut clocks = 0;
    let mut warmups = 0;
    let mut audio_setups = 0;
    while let Ok((_, event)) = events.try_recv() {
        match event {
            PlaybackTelemetryEvent::ClockStarted { .. } => clocks += 1,
            PlaybackTelemetryEvent::WarmupComplete { .. } => warmups += 1,
            PlaybackTelemetryEvent::AudioPipelineReady { .. } => audio_setups += 1,
            _ => {}
        }
    }
    let samples = audio_samples.load(Ordering::Relaxed);
    let passed = clocks == 1 && warmups == 1 && audio_setups == 1 && samples > 0;
    let report = serde_json::json!({
        "passed":passed,"catalogue":catalogue,"observations":observations,"frames":frames,
        "clocks":clocks,"warmups":warmups,"audioSetups":audio_setups,"audioSamples":samples,
        "displayFpsVerified":false
    });
    std::fs::write(
        output_path,
        serde_json::to_vec_pretty(&report).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    if !passed {
        return Err("Resolution updates restarted playback or audio".into());
    }
    println!(
        "{} resolution/canvas observations passed",
        observations.len()
    );
    Ok(())
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
            .map_err(|_| "Resolution verification worker panicked".to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|error| error.to_string())?
        .block_on(run())
}
