mod animated_gradient;
mod bookmarks;
mod caption_timing;
mod configuration;
pub mod cursor;
mod format;
pub mod keyboard;
mod meta;
mod portable;

pub use animated_gradient::*;
pub use bookmarks::*;
pub use caption_timing::{derive_caption_track_segments, source_caption_id, synchronize_captions};
pub use configuration::*;
pub use cursor::*;
pub use format::*;
pub use keyboard::*;
pub use meta::*;
pub use portable::*;

use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RecordingConfig {
    pub fps: u32,
    pub resolution: Resolution,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct Resolution {
    pub width: u32,
    pub height: u32,
}

impl Default for RecordingConfig {
    fn default() -> Self {
        Self {
            fps: 30,
            resolution: Resolution {
                width: 1920,
                height: 1080,
            },
        }
    }
}
