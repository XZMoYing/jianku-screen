use cap_editor::{AudioOutput, EditorFrameOutput, EditorInstance, PlaybackHandle};
use cap_project::{ProjectConfiguration, XY};
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

#[derive(Clone, Serialize)]
struct AudioBlock {
    seconds: f64,
    mean: f64,
}

#[derive(Clone, Serialize)]
struct VideoFrame {
    seconds: f64,
    frame: u32,
    center: f64,
}

#[derive(Serialize)]
struct Checkpoint {
    name: String,
    elapsed_ms: f64,
    expected: f64,
    actual: f64,
}

struct Probe {
    editor: Arc<EditorInstance>,
    epoch: Instant,
    audio: Arc<Mutex<Vec<AudioBlock>>>,
    video: Arc<Mutex<Vec<VideoFrame>>>,
    project: ProjectConfiguration,
    checkpoints: Vec<Checkpoint>,
}

impl Probe {
    async fn new(path: PathBuf) -> Result<Self, String> {
        let epoch = Instant::now();
        let audio = Arc::new(Mutex::new(Vec::new()));
        let video = Arc::new(Mutex::new(Vec::new()));
        let output = Arc::new(AudioOutput::new_headless(Box::new({
            let audio = audio.clone();
            move |samples, _| {
                let mean = samples.iter().map(|sample| f64::from(*sample)).sum::<f64>()
                    / samples.len() as f64;
                audio.lock().unwrap().push(AudioBlock {
                    seconds: epoch.elapsed().as_secs_f64(),
                    mean,
                });
            }
        })));
        let editor = EditorInstance::new_with_audio_output(
            path,
            |_| {},
            Box::new({
                let video = video.clone();
                move |frame, _| {
                    if let EditorFrameOutput::Rgba(frame) = frame {
                        let offset = (frame.height / 2) as usize
                            * frame.padded_bytes_per_row as usize
                            + (frame.width / 2) as usize * 4;
                        let center = frame.data[offset..offset + 3]
                            .iter()
                            .map(|v| f64::from(*v))
                            .sum::<f64>()
                            / 3.0;
                        video.lock().unwrap().push(VideoFrame {
                            seconds: epoch.elapsed().as_secs_f64(),
                            frame: frame.frame_number,
                            center,
                        });
                    }
                }
            }),
            None,
            output,
        )
        .await?;
        let project = editor.project_config.1.borrow().clone();
        Ok(Self {
            editor,
            epoch,
            audio,
            video,
            project,
            checkpoints: Vec::new(),
        })
    }

    fn update(&self) {
        self.editor
            .project_config
            .0
            .send_replace(self.project.clone());
    }

    async fn expect(&mut self, name: &str, expected: f64) -> Result<(), String> {
        let start = Instant::now();
        let since = self.epoch.elapsed().as_secs_f64();
        loop {
            let recent: Vec<_> = self
                .audio
                .lock()
                .unwrap()
                .iter()
                .rev()
                .take(4)
                .cloned()
                .collect();
            if recent.len() == 4
                && recent
                    .iter()
                    .all(|block| block.seconds > since && (block.mean - expected).abs() < 0.004)
            {
                let actual = recent.iter().map(|block| block.mean).sum::<f64>() / 4.0;
                self.checkpoints.push(Checkpoint {
                    name: name.into(),
                    elapsed_ms: start.elapsed().as_secs_f64() * 1000.0,
                    expected,
                    actual,
                });
                return Ok(());
            }
            if start.elapsed() > Duration::from_secs(3) {
                return Err(format!(
                    "{name}: expected {expected}, last blocks={:?}",
                    recent.iter().map(|block| block.mean).collect::<Vec<_>>()
                ));
            }
            tokio::time::sleep(Duration::from_millis(15)).await;
        }
    }

    async fn video_at(&self, target: u32) -> Result<(), String> {
        let start = Instant::now();
        loop {
            if let Some(frame) = self
                .video
                .lock()
                .unwrap()
                .last()
                .filter(|frame| frame.frame >= target && frame.frame < target + 30)
            {
                let source = self
                    .project
                    .get_segment_time(f64::from(frame.frame) / 30.0)
                    .ok_or("Missing source mapping")?
                    .0;
                let expected = ((40.0 + 40.0 * source.floor().rem_euclid(4.0) - 16.0) * 255.0
                    / 219.0)
                    .clamp(0.0, 255.0);
                if (frame.center - expected).abs() <= 3.0 {
                    return Ok(());
                }
            }
            if start.elapsed() > Duration::from_secs(4) {
                let last = self.video.lock().unwrap().last().cloned();
                return Err(format!(
                    "Did not present source-correct video after seek {target}; last frame={:?}",
                    last.map(|frame| (frame.frame, frame.center))
                ));
            }
            tokio::time::sleep(Duration::from_millis(15)).await;
        }
    }

    async fn stop(&self, handle: &PlaybackHandle) -> Result<(), String> {
        handle.stop();
        let mut active = self.editor.playback_watch();
        tokio::time::timeout(Duration::from_secs(3), async {
            while *active.borrow_and_update() {
                active.changed().await.map_err(|error| error.to_string())?;
            }
            Ok::<_, String>(())
        })
        .await
        .map_err(|error| error.to_string())?
    }

    async fn run(&mut self) -> Result<(), String> {
        let mut handle = self
            .editor
            .start_playback_with_handle(30, XY::new(640, 360), Some(0))
            .await
            .map_err(|error| format!("{error:?}"))?;
        self.expect("initial-silence", 0.0).await?;
        self.project.timeline.as_mut().unwrap().audio_segments =
            serde_json::from_value(serde_json::json!([
                {"start": 0.0, "end": 60.0, "path": "content/music-a.wav", "track": 0}
            ]))
            .map_err(|error| error.to_string())?;
        self.update();
        self.expect("add-music-while-playing", 8000.0 / 32768.0 * 0.707)
            .await?;
        let playhead = f64::from(
            self.video
                .lock()
                .unwrap()
                .last()
                .ok_or("Missing playback frame")?
                .frame,
        ) / 30.0;
        self.project.timeline.as_mut().unwrap().audio_segments[0].fade_in = 60.0;
        self.update();
        self.expect("live-fade-in", 8000.0 / 32768.0 * 0.707 * playhead / 60.0)
            .await?;
        self.project.timeline.as_mut().unwrap().audio_segments[0].fade_in = 0.0;
        self.update();
        self.expect("reset-fade-in", 8000.0 / 32768.0 * 0.707)
            .await?;
        let playhead = f64::from(
            self.video
                .lock()
                .unwrap()
                .last()
                .ok_or("Missing playback frame")?
                .frame,
        ) / 30.0;
        self.project.timeline.as_mut().unwrap().audio_segments[0].end = playhead + 5.0;
        self.project.timeline.as_mut().unwrap().audio_segments[0].fade_out = 60.0;
        self.update();
        self.expect("live-fade-out", 8000.0 / 32768.0 * 0.707 * 5.0 / 60.0)
            .await?;
        self.project.timeline.as_mut().unwrap().audio_segments[0].end = 60.0;
        self.project.timeline.as_mut().unwrap().audio_segments[0].fade_out = 0.0;
        self.update();
        self.expect("reset-fade-out", 8000.0 / 32768.0 * 0.707)
            .await?;
        self.project.timeline.as_mut().unwrap().audio_segments[0].volume_db = -12.0;
        self.update();
        self.expect(
            "live-volume",
            8000.0 / 32768.0 * 0.707 * 10.0_f64.powf(-12.0 / 20.0),
        )
        .await?;
        self.project.timeline.as_mut().unwrap().audio_segments[0].volume_db = 0.0;
        self.project.timeline.as_mut().unwrap().audio_segments[0].path =
            "content/music-b.wav".into();
        self.update();
        self.expect("replace-music-while-playing", 4000.0 / 32768.0 * 0.707)
            .await?;
        self.project.timeline.as_mut().unwrap().audio_segments[0].trim_start = 120.0;
        self.update();
        self.expect("live-trim-outside-cached-range", 6000.0 / 32768.0 * 0.707)
            .await?;
        self.project.timeline.as_mut().unwrap().audio_segments[0].enabled = false;
        self.update();
        self.expect("disable-track", 0.0).await?;
        self.project.timeline.as_mut().unwrap().audio_segments[0].enabled = true;
        self.update();
        self.expect("reenable-track", 6000.0 / 32768.0 * 0.707)
            .await?;
        let mut second = self.project.timeline.as_ref().unwrap().audio_segments[0].clone();
        second.path = "content/music-a.wav".into();
        second.trim_start = 0.0;
        second.track = 1;
        self.project
            .timeline
            .as_mut()
            .unwrap()
            .audio_segments
            .push(second);
        self.update();
        self.expect("overlapping-tracks", 14000.0 / 32768.0 * 0.707)
            .await?;
        self.project
            .timeline
            .as_mut()
            .unwrap()
            .audio_segments
            .remove(0);
        self.project.timeline.as_mut().unwrap().segments[3].end = 115.0;
        self.project.timeline.as_mut().unwrap().audio_segments[0].end = 70.0;
        self.update();
        self.expect("remove-track-and-extend-timeline", 8000.0 / 32768.0 * 0.707)
            .await?;
        if !handle.seek(2046) {
            return Err("Seek request rejected".into());
        }
        self.video_at(2046).await?;
        self.expect("extended-tail-audio", 8000.0 / 32768.0 * 0.707)
            .await?;
        for round in 0..3 {
            self.stop(&handle).await?;
            self.expect(&format!("pause-{round}"), 0.0).await?;
            handle = self
                .editor
                .start_playback_with_handle(30, XY::new(640, 360), Some(0))
                .await
                .map_err(|error| format!("{error:?}"))?;
            self.video_at(3).await?;
            self.expect(
                &format!("rewind-and-replay-{round}"),
                8000.0 / 32768.0 * 0.707,
            )
            .await?;
        }
        self.stop(&handle).await?;
        Ok(())
    }
}

#[tokio::main]
async fn main() -> Result<(), String> {
    let args: Vec<_> = std::env::args().collect();
    let project = args
        .get(1)
        .ok_or("Usage: playback-mix-check PROJECT OUTPUT_JSON")?;
    let output = args.get(2).ok_or("Missing output path")?;
    ffmpeg::init().map_err(|error| error.to_string())?;
    let mut probe = Probe::new(PathBuf::from(project)).await?;
    let result = probe.run().await;
    probe.editor.dispose().await;
    let report = serde_json::json!({
        "passed": result.is_ok(), "error": result.as_ref().err(), "checkpoints": probe.checkpoints,
        "audio": *probe.audio.lock().unwrap(), "video": *probe.video.lock().unwrap(),
        "scope": "Native editor/GPU with production headless audio callback; not physical audio-device or WebView display validation."
    });
    std::fs::write(
        output,
        serde_json::to_vec_pretty(&report).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    result
}
