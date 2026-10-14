use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum MobileCaptureOrientation {
    #[default]
    Initial,
    Natural,
    Rotate90,
    Rotate180,
    Rotate270,
}

impl MobileCaptureOrientation {
    fn scrcpy_value(self) -> &'static str {
        match self {
            Self::Initial => "@",
            Self::Natural => "@0",
            Self::Rotate90 => "@90",
            Self::Rotate180 => "@180",
            Self::Rotate270 => "@270",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", default)]
pub struct MobileCaptureSettings {
    pub max_size: u32,
    pub max_fps: u32,
    pub bit_rate_mbps: u32,
    pub orientation: MobileCaptureOrientation,
}

impl Default for MobileCaptureSettings {
    fn default() -> Self {
        Self {
            max_size: 0,
            max_fps: 60,
            bit_rate_mbps: 16,
            orientation: MobileCaptureOrientation::Initial,
        }
    }
}

impl MobileCaptureSettings {
    pub(super) fn validate(self) -> Result<(), String> {
        if ![0, 1280, 1920, 2560, 3840].contains(&self.max_size)
            || ![30, 60].contains(&self.max_fps)
            || ![8, 16, 32].contains(&self.bit_rate_mbps)
        {
            return Err("设备录制参数不受支持，请重新选择画质、尺寸和帧率。".into());
        }
        Ok(())
    }

    pub(super) fn scrcpy_args(self) -> Result<Vec<String>, String> {
        self.validate()?;
        Ok(vec![
            format!("--max-size={}", self.max_size),
            format!("--max-fps={}", self.max_fps),
            format!("--video-bit-rate={}M", self.bit_rate_mbps),
            format!("--capture-orientation={}", self.orientation.scrcpy_value()),
        ])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_options_default_to_original_size_and_locked_initial_orientation() {
        let settings: MobileCaptureSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(settings, MobileCaptureSettings::default());
        assert!(
            settings
                .scrcpy_args()
                .unwrap()
                .contains(&"--capture-orientation=@".into())
        );
        assert_eq!(settings.max_size, 0);
        let old: super::super::MobileRecordingOptions = serde_json::from_str(
            r#"{"platform":"android","deviceId":"fixture","audio":false,"preview":false}"#,
        )
        .unwrap();
        assert_eq!(old.capture, settings);
    }

    #[test]
    fn invalid_options_are_rejected_before_starting_a_device_process() {
        for settings in [
            MobileCaptureSettings {
                max_size: 8192,
                ..Default::default()
            },
            MobileCaptureSettings {
                max_fps: 0,
                ..Default::default()
            },
            MobileCaptureSettings {
                bit_rate_mbps: u32::MAX,
                ..Default::default()
            },
        ] {
            assert!(settings.scrcpy_args().is_err());
        }
        assert!(
            serde_json::from_str::<MobileCaptureSettings>(r#"{"orientation":"unlocked"}"#).is_err()
        );
    }

    #[test]
    fn installed_scrcpy_accepts_capture_options_without_connecting_to_a_device() {
        let scrcpy = super::super::tool("scrcpy").expect("option verification requires scrcpy");
        for orientation in [
            MobileCaptureOrientation::Initial,
            MobileCaptureOrientation::Natural,
            MobileCaptureOrientation::Rotate90,
            MobileCaptureOrientation::Rotate180,
            MobileCaptureOrientation::Rotate270,
        ] {
            let settings = MobileCaptureSettings {
                max_size: 1920,
                max_fps: 30,
                bit_rate_mbps: 8,
                orientation,
            };
            let result = std::process::Command::new(&scrcpy)
                .args(settings.scrcpy_args().unwrap())
                .arg("--version")
                .output()
                .unwrap();
            assert!(
                result.status.success(),
                "{}",
                String::from_utf8_lossy(&result.stderr)
            );
        }
    }
}
