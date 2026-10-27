use std::time::{Duration, Instant};

use tokio::sync::mpsc;

#[derive(Clone)]
pub struct PlaybackTelemetry {
    sink: PlaybackTelemetrySink,
}

#[derive(Clone)]
enum PlaybackTelemetrySink {
    Event(mpsc::UnboundedSender<PlaybackTelemetryEvent>),
    Timed(mpsc::UnboundedSender<(Instant, PlaybackTelemetryEvent)>),
}

impl PlaybackTelemetry {
    pub fn channel() -> (Self, mpsc::UnboundedReceiver<PlaybackTelemetryEvent>) {
        let (tx, rx) = mpsc::unbounded_channel();
        (
            Self {
                sink: PlaybackTelemetrySink::Event(tx),
            },
            rx,
        )
    }

    pub fn timed_channel() -> (
        Self,
        mpsc::UnboundedReceiver<(Instant, PlaybackTelemetryEvent)>,
    ) {
        let (tx, rx) = mpsc::unbounded_channel();
        (
            Self {
                sink: PlaybackTelemetrySink::Timed(tx),
            },
            rx,
        )
    }

    pub(crate) fn emit(&self, event: PlaybackTelemetryEvent) {
        match &self.sink {
            PlaybackTelemetrySink::Event(tx) => {
                let _ = tx.send(event);
            }
            PlaybackTelemetrySink::Timed(tx) => {
                let _ = tx.send((Instant::now(), event));
            }
        }
    }
}

#[derive(Debug, Clone)]
pub enum PlaybackTelemetryEvent {
    /// The background audio decodes awaited by `Playback::start` resolved.
    AudioSegmentsResolved {
        elapsed: Duration,
    },
    WarmupComplete {
        elapsed: Duration,
        buffered_frames: usize,
        target_frames: usize,
        start_frame_number: u32,
    },
    /// The audio output pipeline finished setup (mix render, stream build,
    /// first device callback). `elapsed` is how long the playback thread was
    /// blocked on it.
    AudioPipelineReady {
        elapsed: Duration,
        has_audio: bool,
    },
    /// The playback clock started; `elapsed` is the total latency from the
    /// `Playback::start` call — the user-perceived press-play delay.
    ClockStarted {
        elapsed: Duration,
    },
    FrameSubmitted {
        frame_number: u32,
        source: PlaybackFrameSource,
        schedule_overshoot: Duration,
        frame_acquire_duration: Duration,
        uniforms_duration: Duration,
        submit_duration: Duration,
        prefetch_buffer_len: usize,
        total_frames_skipped: u64,
    },
    FrameSkipped {
        frame_number: u32,
        skipped: u32,
        reason: PlaybackSkipReason,
        prefetch_buffer_len: usize,
    },
    RendererFrame {
        frame_number: u32,
        input_frame_number: u32,
        queue_wait: Duration,
        drain_duration: Duration,
        flush_duration: Duration,
        render_duration: Duration,
        render_stage_timings: Box<cap_rendering::FrameRenderStageTimings>,
        callback_duration: Duration,
        drained_count: u32,
        output_format: PlaybackRenderOutputFormat,
    },
    RendererPrepared {
        output_width: u32,
        output_height: u32,
        duration: Duration,
    },
    RendererDropped {
        frame_number: u32,
        replacement_frame_number: u32,
    },
    RendererSendFailed {
        frame_number: u32,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PlaybackFrameSource {
    InitialPrerender,
    Cache,
    PrefetchFront,
    PrefetchSearch,
    PrefetchWaitExact,
    PrefetchWaitFuture,
    LateDrain,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PlaybackSkipReason {
    ScheduleOvershoot,
    PrefetchTimeout,
    PrefetchBehind,
    PrefetchGap,
    ClockDrift,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PlaybackRenderOutputFormat {
    Nv12,
    Rgba,
    Bgra,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn delayed_collection_preserves_producer_emission_time() {
        let (telemetry, mut receiver) = PlaybackTelemetry::timed_channel();
        let before = Instant::now();
        telemetry.emit(PlaybackTelemetryEvent::ClockStarted {
            elapsed: Duration::ZERO,
        });
        let after = Instant::now();
        tokio::time::sleep(Duration::from_millis(15)).await;
        let (emitted, event) = receiver.recv().await.unwrap();
        assert!(emitted >= before && emitted <= after);
        assert!(matches!(event, PlaybackTelemetryEvent::ClockStarted { .. }));
        assert!(emitted < Instant::now());
    }
}
