use serde::{Deserialize, Serialize};
use specta::Type;

use crate::audio::AudioExportSettings;
use crate::gif::GifExportSettings;
use crate::mov::MovExportSettings;
use crate::mp4::Mp4ExportSettings;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Type)]
#[serde(tag = "format")]
pub enum ExportSettings {
    #[serde(alias = "mp4")]
    Mp4(Mp4ExportSettings),
    #[serde(alias = "gif")]
    Gif(GifExportSettings),
    #[serde(alias = "mov")]
    Mov(MovExportSettings),
    #[serde(alias = "audio")]
    Audio(AudioExportSettings),
}

impl ExportSettings {
    pub fn fps(&self) -> u32 {
        match self {
            Self::Mp4(s) => s.fps,
            Self::Gif(s) => s.fps,
            Self::Mov(s) => s.fps,
            Self::Audio(_) => AudioExportSettings::PROGRESS_FPS,
        }
    }

    pub fn force_ffmpeg_decoder(&self) -> bool {
        match self {
            Self::Mp4(s) => s.force_ffmpeg_decoder,
            Self::Gif(_) | Self::Mov(_) | Self::Audio(_) => false,
        }
    }

    pub fn cursor_only(&self) -> bool {
        match self {
            Self::Mov(s) => s.cursor_only,
            _ => false,
        }
    }

    pub fn screen_enhancement(&self) -> bool {
        match self {
            Self::Mp4(s) => s.screen_enhancement,
            Self::Gif(s) => s.screen_enhancement,
            Self::Mov(s) => s.screen_enhancement,
            Self::Audio(_) => false,
        }
    }
}
