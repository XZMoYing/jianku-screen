use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{RecvTimeoutError, sync_channel},
    },
    thread,
    time::Duration,
};

use cap_recording::diagnostics::{AudioOutputDiagnostics, MicrophoneDiagnostics};

static AUDIO_PROBE_BUSY: AtomicBool = AtomicBool::new(false);
const AUDIO_PROBE_TIMEOUT: Duration = Duration::from_secs(4);

#[derive(Debug, PartialEq, Eq)]
pub(super) enum AudioProbeFailure {
    Busy,
    TimedOut,
    Unavailable,
}

impl AudioProbeFailure {
    pub(super) fn status(&self) -> &'static str {
        match self {
            Self::Busy => "busy",
            Self::TimedOut => "timed_out",
            Self::Unavailable => "unavailable",
        }
    }
}

struct WorkerSlot(&'static AtomicBool);

impl Drop for WorkerSlot {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

fn probe_with_deadline<T: Send + 'static>(
    busy: &'static AtomicBool,
    timeout: Duration,
    probe: impl FnOnce() -> T + Send + 'static,
) -> Result<T, AudioProbeFailure> {
    busy.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map_err(|_| AudioProbeFailure::Busy)?;
    let slot = WorkerSlot(busy);
    let (sender, receiver) = sync_channel(1);

    // CoreAudio calls cannot be interrupted. Keep the slot with the worker,
    // so timing out does not let a later diagnostic spawn another stuck probe.
    thread::Builder::new()
        .name("diagnostic-audio-probe".to_string())
        .spawn(move || {
            let _slot = slot;
            let _ = sender.send(probe());
        })
        .map_err(|_| AudioProbeFailure::Unavailable)?;

    receiver.recv_timeout(timeout).map_err(|error| match error {
        RecvTimeoutError::Timeout => AudioProbeFailure::TimedOut,
        RecvTimeoutError::Disconnected => AudioProbeFailure::Unavailable,
    })
}

pub(super) fn collect_audio_devices()
-> Result<(Vec<MicrophoneDiagnostics>, Vec<AudioOutputDiagnostics>), AudioProbeFailure> {
    probe_with_deadline(&AUDIO_PROBE_BUSY, AUDIO_PROBE_TIMEOUT, || {
        (
            cap_recording::diagnostics::collect_microphones(),
            cap_recording::diagnostics::collect_audio_outputs(),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_timed_out_worker_holds_its_slot_until_it_finishes() {
        static BUSY: AtomicBool = AtomicBool::new(false);
        let (release, wait) = sync_channel::<()>(1);
        let result = probe_with_deadline(&BUSY, Duration::from_millis(15), move || {
            let _ = wait.recv();
            3
        });

        assert_eq!(result, Err(AudioProbeFailure::TimedOut));
        let duplicate = probe_with_deadline(&BUSY, Duration::from_secs(1), || {
            panic!("a second worker must not start while the first is blocked");
        });
        assert_eq!(duplicate, Err(AudioProbeFailure::Busy));

        release.send(()).unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(1);
        while BUSY.load(Ordering::Acquire) && std::time::Instant::now() < deadline {
            thread::sleep(Duration::from_millis(1));
        }
        assert_eq!(
            probe_with_deadline(&BUSY, Duration::from_secs(1), || 5),
            Ok(5)
        );
    }
}
