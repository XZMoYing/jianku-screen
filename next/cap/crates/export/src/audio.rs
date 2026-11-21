//! Audio-only export (MP3 via LAME and 16-bit PCM WAV).
//!
//! Renders the project's full edited audio mix — including Voice EQ, de-click,
//! Studio Sound, BS.1770 loudness leveling, hard-cut join fades, clip transitions,
//! speed audio, and music tracks — identically to MP4 export.

use std::{
    fs::File,
    io::{BufWriter, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    time::Duration,
};

use cap_editor::{AudioRenderer, get_audio_segments, load_music_tracks_uncached};
use cap_enc_ffmpeg::mp3::Mp3Encoder;
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::ExporterBase;

pub const WAV_BITS_PER_SAMPLE: u16 = 16;
const WAV_CHANNELS: u16 = 2;
const WAV_HEADER_BYTES: u64 = 44;
const MP3_OVERHEAD_BYTES: u64 = 4_096;
const AUDIO_EXPORT_FPS: u32 = 30;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Hash, Type)]
#[serde(rename_all = "camelCase")]
pub enum AudioExportFormat {
    Mp3,
    Wav,
}

impl AudioExportFormat {
    pub fn extension(self) -> &'static str {
        match self {
            Self::Mp3 => "mp3",
            Self::Wav => "wav",
        }
    }

    pub fn is_available(self) -> bool {
        match self {
            Self::Mp3 => {
                let _ = ffmpeg::init();
                Mp3Encoder::is_available()
            }
            Self::Wav => true,
        }
    }

    pub fn estimated_bytes(self, duration_secs: f64) -> u64 {
        let duration_secs = if duration_secs.is_finite() {
            duration_secs.max(0.0)
        } else {
            0.0
        };
        match self {
            Self::Mp3 => {
                (duration_secs * Mp3Encoder::DEFAULT_BITRATE as f64 / 8.0).ceil() as u64
                    + MP3_OVERHEAD_BYTES
            }
            Self::Wav => {
                let frames = (duration_secs * f64::from(AudioRenderer::SAMPLE_RATE)).ceil() as u64;
                WAV_HEADER_BYTES
                    + frames * u64::from(WAV_CHANNELS) * u64::from(WAV_BITS_PER_SAMPLE / 8)
            }
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Type)]
pub struct AudioExportSettings {
    pub codec: AudioExportFormat,
}

impl AudioExportSettings {
    pub const PROGRESS_FPS: u32 = AUDIO_EXPORT_FPS;

    pub async fn export(
        self,
        base: ExporterBase,
        mut on_progress: impl FnMut(u32) -> bool + Send + 'static,
    ) -> Result<PathBuf, String> {
        if !self.codec.is_available() {
            return Err("MP3 export is not available in this build".into());
        }

        let audio_segments = get_audio_segments(&base.segments).await;
        let music = load_music_tracks_uncached(&base.project_config, &base.project_path);
        let has_recording_audio = audio_segments
            .first()
            .filter(|_| !base.project_config.audio.mute)
            .is_some();
        if !has_recording_audio && music.is_empty() {
            return Err("This recording has no sound to export".into());
        }

        let total_frames = base.total_frames(Self::PROGRESS_FPS).max(1);
        let output_path = base.output_path.clone();
        let project = base.project_config.clone();
        let format = self.codec;

        tokio::task::spawn_blocking(move || {
            let mut renderer = AudioRenderer::new(audio_segments).with_music(music);
            renderer.set_playhead(0.0, &project);

            let parent = output_path
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| PathBuf::from("."));
            std::fs::create_dir_all(&parent)
                .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;

            let temp = tempfile::Builder::new()
                .prefix(".cap-audio-export-")
                .suffix(&format!(".{}", format.extension()))
                .tempfile_in(&parent)
                .map_err(|error| format!("Could not create temp audio file: {error}"))?;
            let temp_path = temp.into_temp_path();

            let result = match format {
                AudioExportFormat::Mp3 => write_mp3(
                    &temp_path,
                    &mut renderer,
                    &project,
                    total_frames,
                    &mut on_progress,
                ),
                AudioExportFormat::Wav => write_wav(
                    &temp_path,
                    &mut renderer,
                    &project,
                    total_frames,
                    &mut on_progress,
                ),
            };
            result?;

            temp_path.persist(&output_path).map_err(|error| {
                format!("Could not save {}: {}", output_path.display(), error.error)
            })?;

            Ok(output_path)
        })
        .await
        .map_err(|error| error.to_string())?
    }
}

fn write_mp3(
    path: &Path,
    renderer: &mut AudioRenderer,
    project: &cap_project::ProjectConfiguration,
    total_frames: u32,
    on_progress: &mut (impl FnMut(u32) -> bool + Send),
) -> Result<(), String> {
    ffmpeg::init().map_err(|error| format!("FFmpeg init failed: {error}"))?;
    let mut output = ffmpeg::format::output(path).map_err(|error| error.to_string())?;
    let mut encoder = Mp3Encoder::init(
        AudioRenderer::info(),
        Mp3Encoder::DEFAULT_BITRATE,
        &mut output,
    )
    .map_err(|error| error.to_string())?;
    output.write_header().map_err(|error| error.to_string())?;

    let samples_per_step = (AudioRenderer::SAMPLE_RATE / AUDIO_EXPORT_FPS) as usize;
    let mut emitted_samples = 0u64;
    for step in 0..total_frames {
        let Some((rendered, samples)) = renderer.render_frame_raw(samples_per_step, project) else {
            break;
        };
        if rendered == 0 {
            break;
        }
        let mut frame = ffmpeg::frame::Audio::new(
            AudioRenderer::SAMPLE_FORMAT,
            rendered,
            ffmpeg::ChannelLayout::STEREO,
        );
        frame.set_rate(AudioRenderer::SAMPLE_RATE);
        for (sample, bytes) in samples[..rendered * 2].iter().zip(
            frame
                .data_mut(0)
                .chunks_exact_mut(std::mem::size_of::<f32>()),
        ) {
            bytes.copy_from_slice(&sample.to_ne_bytes());
        }
        let timestamp =
            Duration::from_secs_f64(emitted_samples as f64 / f64::from(AudioRenderer::SAMPLE_RATE));
        encoder
            .queue_frame(frame, timestamp, &mut output)
            .map_err(|error| error.to_string())?;
        emitted_samples += rendered as u64;
        if !on_progress(step) {
            return Err("Export cancelled".into());
        }
    }

    encoder
        .flush(&mut output)
        .map_err(|error| error.to_string())?;
    output.write_trailer().map_err(|error| error.to_string())?;
    Ok(())
}

fn write_wav(
    path: &Path,
    renderer: &mut AudioRenderer,
    project: &cap_project::ProjectConfiguration,
    total_frames: u32,
    on_progress: &mut (impl FnMut(u32) -> bool + Send),
) -> Result<(), String> {
    let file = File::create(path).map_err(|error| error.to_string())?;
    let mut writer = BufWriter::new(file);
    writer
        .write_all(&[0u8; 44])
        .map_err(|error| error.to_string())?;

    let samples_per_step = (AudioRenderer::SAMPLE_RATE / AUDIO_EXPORT_FPS) as usize;
    let mut data_bytes = 0u64;
    let mut pcm_bytes = Vec::with_capacity(samples_per_step * 4);
    for step in 0..total_frames {
        let Some((rendered, samples)) = renderer.render_frame_raw(samples_per_step, project) else {
            break;
        };
        if rendered == 0 {
            break;
        }
        pcm_bytes.clear();
        for &sample in &samples[..rendered * 2] {
            let clamped = if sample.is_finite() {
                sample.clamp(-1.0, 1.0)
            } else {
                0.0
            };
            let q = (clamped * f32::from(i16::MAX)).round() as i16;
            pcm_bytes.extend_from_slice(&q.to_le_bytes());
        }
        writer
            .write_all(&pcm_bytes)
            .map_err(|error| error.to_string())?;
        data_bytes += pcm_bytes.len() as u64;
        if !on_progress(step) {
            return Err("Export cancelled".into());
        }
    }

    let data_len = u32::try_from(data_bytes)
        .map_err(|_| "WAV export exceeded 4 GiB RIFF size limit".to_string())?;
    let byte_rate = AudioRenderer::SAMPLE_RATE * u32::from(WAV_CHANNELS) * 2;
    let block_align = WAV_CHANNELS * 2;
    let mut header = [0u8; 44];
    header[0..4].copy_from_slice(b"RIFF");
    header[4..8].copy_from_slice(&(36u32.saturating_add(data_len)).to_le_bytes());
    header[8..12].copy_from_slice(b"WAVE");
    header[12..16].copy_from_slice(b"fmt ");
    header[16..20].copy_from_slice(&16u32.to_le_bytes());
    header[20..22].copy_from_slice(&1u16.to_le_bytes()); // PCM
    header[22..24].copy_from_slice(&WAV_CHANNELS.to_le_bytes());
    header[24..28].copy_from_slice(&AudioRenderer::SAMPLE_RATE.to_le_bytes());
    header[28..32].copy_from_slice(&byte_rate.to_le_bytes());
    header[32..34].copy_from_slice(&block_align.to_le_bytes());
    header[34..36].copy_from_slice(&WAV_BITS_PER_SAMPLE.to_le_bytes());
    header[36..40].copy_from_slice(b"data");
    header[40..44].copy_from_slice(&data_len.to_le_bytes());

    writer.flush().map_err(|error| error.to_string())?;
    let mut file = writer.into_inner().map_err(|error| error.to_string())?;
    file.seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    file.write_all(&header).map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    Ok(())
}
