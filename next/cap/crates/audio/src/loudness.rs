//! ITU-R BS.1770-4 K-weighted integrated loudness analyzer and calibration gain.
//!
//! Measures a stable loudness baseline on each original recording so timeline
//! cuts never alter the leveling gain and preview matches export identically.

use crate::{AudioData, AudioSampleSource};

pub const TARGET_LUFS: f64 = -16.0;
pub const MAX_BOOST_DB: f64 = 14.0;
pub const MINIMUM_LUFS: f64 = -42.0;

const HOP_FRAMES_48K: usize = 4_800; // 100 ms at 48 kHz (4 hops = 400 ms block)
const MINIMUM_AUDIBLE_BLOCKS: usize = 8;

/// ITU-R BS.1770-4 Table 1 (Stage 1 pre-filter) and Table 2 (Stage 2 RLB high-pass)
/// biquad coefficients at 48 kHz: (b0, b1, b2, a1, a2).
const STAGE1_48K: [f64; 5] = [
    1.535_124_859_586_97,
    -2.691_696_189_406_38,
    1.198_392_810_852_85,
    -1.690_659_293_182_41,
    0.732_480_774_215_85,
];
const STAGE2_48K: [f64; 5] = [1.0, -2.0, 1.0, -1.990_047_454_833_98, 0.990_072_250_366_21];

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LoudnessProfile {
    pub integrated_lufs: Option<f64>,
    pub calibration_gain: f32,
    pub has_audible_program_audio: bool,
}

impl LoudnessProfile {
    pub const UNITY: Self = Self {
        integrated_lufs: None,
        calibration_gain: 1.0,
        has_audible_program_audio: false,
    };

    pub fn boost_db(self) -> f32 {
        if self.calibration_gain <= 1.0 || !self.calibration_gain.is_finite() {
            0.0
        } else {
            20.0 * self.calibration_gain.log10()
        }
    }
}

impl Default for LoudnessProfile {
    fn default() -> Self {
        Self::UNITY
    }
}

#[derive(Clone, Copy, Default)]
struct BiquadState {
    z1: f64,
    z2: f64,
}

impl BiquadState {
    #[inline]
    fn process(&mut self, x: f64, coeff: [f64; 5]) -> f64 {
        let [b0, b1, b2, a1, a2] = coeff;
        let y = b0 * x + self.z1;
        self.z1 = b1 * x - a1 * y + self.z2;
        self.z2 = b2 * x - a2 * y;
        y
    }
}

#[derive(Clone, Copy, Default)]
struct KWeightingChannel {
    stage1: BiquadState,
    stage2: BiquadState,
}

impl KWeightingChannel {
    #[inline]
    fn process(&mut self, sample: f32) -> f64 {
        let s1 = self.stage1.process(f64::from(sample), STAGE1_48K);
        self.stage2.process(s1, STAGE2_48K)
    }
}

/// Pure BS.1770-4 gating and calibration policy over 100 ms hop mean-square
/// energies (after K-weighting).
pub fn evaluate_hop_energies(hop_energies: &[f64]) -> LoudnessProfile {
    if hop_energies.len() < 4 {
        return LoudnessProfile::UNITY;
    }

    let mut block_energies = Vec::with_capacity(hop_energies.len() - 3);
    for window in hop_energies.windows(4) {
        let block_mean_square = 0.25 * (window[0] + window[1] + window[2] + window[3]);
        block_energies.push(block_mean_square);
    }

    let absolute_gate_energy = 10f64.powf((-70.0 + 0.691) / 10.0);
    let audible_floor_energy = 10f64.powf((MINIMUM_LUFS + 0.691) / 10.0);

    let mut absolute_passed = Vec::new();
    let mut audible_block_count = 0usize;
    for &energy in &block_energies {
        if energy > absolute_gate_energy {
            absolute_passed.push(energy);
        }
        if energy > audible_floor_energy {
            audible_block_count += 1;
        }
    }

    if absolute_passed.is_empty() || audible_block_count < MINIMUM_AUDIBLE_BLOCKS {
        return LoudnessProfile::UNITY;
    }

    let absolute_mean = absolute_passed.iter().sum::<f64>() / absolute_passed.len() as f64;
    let absolute_lufs = -0.691 + 10.0 * absolute_mean.log10();
    let relative_gate_energy = 10f64.powf((absolute_lufs - 10.0 + 0.691) / 10.0);

    let mut gated_sum = 0.0f64;
    let mut gated_count = 0usize;
    for &energy in &absolute_passed {
        if energy > relative_gate_energy {
            gated_sum += energy;
            gated_count += 1;
        }
    }
    if gated_count == 0 {
        return LoudnessProfile::UNITY;
    }

    let gated_mean = gated_sum / gated_count as f64;
    let integrated_lufs = -0.691 + 10.0 * gated_mean.log10();
    if !integrated_lufs.is_finite() || integrated_lufs < MINIMUM_LUFS {
        return LoudnessProfile::UNITY;
    }

    // Only lift quiet recordings; never attenuate a source already at or above target.
    let boost_db = (TARGET_LUFS - integrated_lufs).clamp(0.0, MAX_BOOST_DB);
    let gain = 10f64.powf(boost_db / 20.0) as f32;
    LoudnessProfile {
        integrated_lufs: Some(integrated_lufs),
        calibration_gain: if gain.is_finite() { gain.max(1.0) } else { 1.0 },
        has_audible_program_audio: true,
    }
}

/// Streaming BS.1770-4 loudness meter expecting 48 kHz interleaved float PCM
/// (mono or stereo; channels > 2 measure the first two channels).
pub struct LoudnessMeter {
    channels: usize,
    left: KWeightingChannel,
    right: KWeightingChannel,
    hop_energies: Vec<f64>,
    accumulated_energy: f64,
    accumulated_frames: usize,
}

impl LoudnessMeter {
    pub fn new(channels: u16) -> Self {
        Self {
            channels: usize::from(channels.max(1)),
            left: KWeightingChannel::default(),
            right: KWeightingChannel::default(),
            hop_energies: Vec::new(),
            accumulated_energy: 0.0,
            accumulated_frames: 0,
        }
    }

    pub fn consume_interleaved(&mut self, samples: &[f32]) {
        if self.channels == 0 || samples.len() < self.channels {
            return;
        }
        let frames = samples.len() / self.channels;
        for frame in 0..frames {
            let base = frame * self.channels;
            let energy = if self.channels == 1 {
                let s = self.left.process(samples[base]);
                // Mono reproduced equally on L/R has 2x channel energy sum in BS.1770-4.
                2.0 * s * s
            } else {
                let l = self.left.process(samples[base]);
                let r = self.right.process(samples[base + 1]);
                l * l + r * r
            };
            self.accumulated_energy += energy;
            self.accumulated_frames += 1;
            if self.accumulated_frames == HOP_FRAMES_48K {
                self.hop_energies
                    .push(self.accumulated_energy / HOP_FRAMES_48K as f64);
                self.accumulated_energy = 0.0;
                self.accumulated_frames = 0;
            }
        }
    }

    pub fn profile(&self) -> LoudnessProfile {
        evaluate_hop_energies(&self.hop_energies)
    }
}

/// Measures the BS.1770-4 loudness profile of an entire 48 kHz audio source.
/// Caps scan length at 10 minutes (28.8M frames) so pathological long recordings
/// still settle in milliseconds while remaining completely cut-independent.
pub fn analyze_source_loudness(source: &impl AudioSampleSource) -> LoudnessProfile {
    const MAX_SCAN_FRAMES: usize = AudioData::SAMPLE_RATE as usize * 600;
    const CHUNK_FRAMES: usize = 8_192;

    let channels = source.channels();
    if channels == 0 {
        return LoudnessProfile::UNITY;
    }
    let ch = usize::from(channels);
    let total_frames = (source.sample_count() / ch).min(MAX_SCAN_FRAMES);
    if total_frames < HOP_FRAMES_48K * 4 {
        return LoudnessProfile::UNITY;
    }

    let mut meter = LoudnessMeter::new(channels);
    let mut scratch = Vec::with_capacity(CHUNK_FRAMES * ch);
    let mut frame = 0usize;
    while frame < total_frames {
        let count = CHUNK_FRAMES.min(total_frames - frame);
        let start = frame * ch;
        let end = start + count * ch;
        if let Some(slice) = source.sample_slice(start..end) {
            meter.consume_interleaved(slice);
        } else {
            scratch.clear();
            for idx in start..end {
                scratch.push(source.sample(idx).copied().unwrap_or(0.0));
            }
            meter.consume_interleaved(&scratch);
        }
        frame += count;
    }
    meter.profile()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine_stereo_48k(amplitude: f32, seconds: f64, freq_hz: f64) -> Vec<f32> {
        let frames = (48_000.0 * seconds) as usize;
        let mut out = Vec::with_capacity(frames * 2);
        for i in 0..frames {
            let t = i as f64 / 48_000.0;
            let sample = (2.0 * std::f64::consts::PI * freq_hz * t).sin() as f32 * amplitude;
            out.push(sample);
            out.push(sample);
        }
        out
    }

    #[test]
    fn silence_returns_unity() {
        let mut meter = LoudnessMeter::new(2);
        meter.consume_interleaved(&vec![0.0f32; 48_000 * 2 * 2]);
        let profile = meter.profile();
        assert_eq!(profile, LoudnessProfile::UNITY);
        assert_eq!(profile.boost_db(), 0.0);
    }

    #[test]
    fn quiet_program_audio_is_lifted_toward_minus_16_lufs() {
        // -26 dBFS 1 kHz stereo sine -> ~-23.7 LUFS -> boosted ~+7.7 dB toward -16 LUFS
        let amp = 10f32.powf(-26.0 / 20.0);
        let samples = sine_stereo_48k(amp, 2.0, 1_000.0);
        let mut meter = LoudnessMeter::new(2);
        meter.consume_interleaved(&samples);
        let profile = meter.profile();
        assert!(profile.has_audible_program_audio);
        let lufs = profile.integrated_lufs.unwrap();
        assert!(lufs < -20.0 && lufs > -30.0, "unexpected lufs={lufs}");
        assert!(
            profile.boost_db() > 5.0 && profile.boost_db() <= MAX_BOOST_DB as f32,
            "boost_db={}",
            profile.boost_db()
        );
    }

    #[test]
    fn loud_program_audio_is_never_attenuated() {
        // -6 dBFS stereo sine is well above -16 LUFS -> gain stays unity (1.0)
        let amp = 10f32.powf(-6.0 / 20.0);
        let samples = sine_stereo_48k(amp, 2.0, 1_000.0);
        let mut meter = LoudnessMeter::new(2);
        meter.consume_interleaved(&samples);
        let profile = meter.profile();
        assert!(profile.has_audible_program_audio);
        assert_eq!(profile.calibration_gain, 1.0);
        assert_eq!(profile.boost_db(), 0.0);
    }

    #[test]
    fn very_quiet_noise_below_floor_stays_unity() {
        // -50 dBFS noise floor must not be amplified
        let amp = 10f32.powf(-50.0 / 20.0);
        let samples = sine_stereo_48k(amp, 2.0, 1_000.0);
        let mut meter = LoudnessMeter::new(2);
        meter.consume_interleaved(&samples);
        assert_eq!(meter.profile(), LoudnessProfile::UNITY);
    }
}
