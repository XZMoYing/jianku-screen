use anyhow::Result;

#[cfg(target_os = "macos")]
mod check {
    use super::*;
    use anyhow::{Context, ensure};
    use cap_project::{BackgroundSource, CursorEvents, ProjectConfiguration, RecordingMeta, XY};
    use cap_rendering::{
        DecodedSegmentFrames, FrameRenderer, ProjectUniforms, RenderOptions, RenderVideoConstants,
        RendererLayers, ZoomTransformTimeline, decoder::DecodedFrame,
    };
    use clap::Parser;
    use serde::Serialize;
    use std::{path::PathBuf, sync::Arc, time::Instant};

    #[derive(Parser)]
    pub struct Args {
        #[arg(long)]
        video: PathBuf,
        #[arg(long)]
        output: PathBuf,
        #[arg(long, default_value_t = 360)]
        duration_frames: u32,
    }

    #[derive(Serialize)]
    struct Sample {
        phase: String,
        frame: u32,
        elapsed_ms: f64,
        mean_difference: f64,
        different_bytes: usize,
    }

    struct Probe<'a> {
        constants: &'a RenderVideoConstants,
        renderer: FrameRenderer<'a>,
        layers: RendererLayers,
        reference: RendererLayers,
        project: ProjectConfiguration,
        zoom: ZoomTransformTimeline,
        source: DecodedFrame,
        cursor: CursorEvents,
    }

    impl<'a> Probe<'a> {
        fn new(constants: &'a RenderVideoConstants, path: PathBuf) -> Self {
            let mut project = ProjectConfiguration::default();
            project.background.source = BackgroundSource::Image {
                path: Some(path.to_string_lossy().into_owned()),
            };
            project.background.padding = 28.0;
            project.background.inset = 48;
            project.background.shadow = 60.0;
            let cursor = CursorEvents::default();
            let zoom = ZoomTransformTimeline::from_project(
                &project,
                &cursor,
                30.0,
                constants.options.screen_size,
            );
            let source =
                DecodedFrame::new_with_arc(Arc::new([40, 60, 80, 255].repeat(640 * 360)), 640, 360);
            Self {
                renderer: FrameRenderer::new(constants),
                layers: RendererLayers::new(&constants.device, &constants.queue),
                reference: RendererLayers::new(&constants.device, &constants.queue),
                constants,
                project,
                zoom,
                source,
                cursor,
            }
        }

        async fn render(&mut self, frame_number: u32, reference: bool) -> Result<Vec<u8>> {
            let frame = DecodedSegmentFrames {
                screen_size: XY::new(640, 360),
                screen_frame: Some(self.source.clone()),
                camera_frame: None,
                segment_time: frame_number as f32 / 60.0,
                recording_time: frame_number as f32 / 60.0,
                segment_has_camera: false,
            };
            let uniforms = ProjectUniforms::new(
                self.constants,
                &self.project,
                frame_number,
                60,
                XY::new(960, 540),
                &self.cursor,
                &frame,
                30.0,
                &self.zoom,
            );
            let output = self
                .renderer
                .render_immediate(
                    frame,
                    uniforms,
                    &self.cursor,
                    true,
                    if reference {
                        &mut self.reference
                    } else {
                        &mut self.layers
                    },
                )
                .await?;
            Ok(output
                .data
                .chunks_exact(output.padded_bytes_per_row as usize)
                .flat_map(|row| row[..output.width as usize * 4].iter().copied())
                .collect())
        }

        async fn compare(&mut self, phase: &str, frame: u32) -> Result<Sample> {
            let start = Instant::now();
            let actual = self.render(frame, false).await?;
            let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
            let expected = self.render(frame, true).await?;
            ensure!(actual.len() == expected.len(), "Output dimensions changed");
            let different_bytes = actual.iter().zip(&expected).filter(|(a, b)| a != b).count();
            let mean_difference = actual
                .iter()
                .zip(&expected)
                .map(|(a, b)| f64::from(a.abs_diff(*b)))
                .sum::<f64>()
                / actual.len() as f64;
            let sample = Sample {
                phase: phase.into(),
                frame,
                elapsed_ms,
                mean_difference,
                different_bytes,
            };
            println!("{}", serde_json::to_string(&sample)?);
            Ok(sample)
        }

        async fn play(&mut self, first: u32) -> Result<()> {
            self.layers.use_realtime_background(true);
            let start = Instant::now();
            for offset in 0..90 {
                tokio::time::sleep_until(
                    (start + std::time::Duration::from_secs_f64(f64::from(offset) / 60.0)).into(),
                )
                .await;
                let _ = self.render(first + offset, false).await?;
            }
            Ok(())
        }
    }

    pub async fn run(args: Args) -> Result<()> {
        let meta: RecordingMeta = serde_json::from_value(serde_json::json!({
            "pretty_name": "wallpaper-handoff-check",
            "display": {"path": "synthetic.png", "fps": 60},
            "camera": null, "audio": null, "cursor": null
        }))?;
        let studio = meta
            .studio_meta()
            .context("Missing studio metadata")?
            .clone();
        let constants = RenderVideoConstants::new_with_options(
            RenderOptions {
                screen_size: XY::new(640, 360),
                camera_size: None,
                preserve_screen_alpha: false,
            },
            meta,
            studio,
        )
        .await?;
        ensure!(!constants.is_software_adapter, "A real GPU is required");
        let mut probe = Probe::new(&constants, args.video.canonicalize()?);
        let mut samples = Vec::new();
        samples.push(probe.compare("initial-precise", 42).await?);
        for round in 0..3 {
            probe.play(0).await?;
            probe.layers.use_realtime_background(false);
            samples.push(
                probe
                    .compare(&format!("paused-forward-{round}"), 114)
                    .await?,
            );
            samples.push(probe.compare(&format!("paused-rewind-{round}"), 0).await?);
            samples.push(
                probe
                    .compare(&format!("paused-loop-{round}"), args.duration_frames + 30)
                    .await?,
            );
            probe.layers.use_precise_background();
            samples.push(
                probe
                    .compare(&format!("precise-handoff-{round}"), 90)
                    .await?,
            );
            samples.push(
                probe
                    .compare(&format!("precise-repeat-{round}"), 90)
                    .await?,
            );
        }
        samples.push(
            probe
                .compare("late-exact-seek", args.duration_frames - 30)
                .await?,
        );
        samples.push(probe.compare("late-seek-rewind", 0).await?);
        std::fs::write(&args.output, serde_json::to_vec_pretty(&samples)?)?;
        ensure!(
            samples.iter().all(|sample| sample.different_bytes == 0),
            "Paused wallpaper differs from exact reference; see {}",
            args.output.display()
        );
        Ok(())
    }

    pub fn main() -> Result<()> {
        let args = Args::parse();
        let worker = std::thread::spawn(|| {
            tokio::runtime::Runtime::new()
                .context("Create check runtime")?
                .block_on(run(args))
        });
        let start = Instant::now();
        while !worker.is_finished() {
            ensure!(start.elapsed().as_secs() < 90, "Wallpaper check timed out");
            objc2::rc::autoreleasepool(|_| {
                let _ =
                    cidre::cf::RunLoop::run_in_mode(cidre::cf::RunLoopMode::default(), 0.01, true);
            });
        }
        worker
            .join()
            .map_err(|_| anyhow::anyhow!("Check panicked"))?
    }
}

#[cfg(target_os = "macos")]
fn main() -> Result<()> {
    check::main()
}

#[cfg(not(target_os = "macos"))]
fn main() -> Result<()> {
    anyhow::bail!("This check uses the macOS wallpaper playback backend")
}
