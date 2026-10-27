use cap_project::{AspectRatio, Crop, ProjectConfiguration, XY};
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::{ProjectUniforms, RenderOptions};

#[derive(Default, Serialize, Deserialize, Type, Debug, Clone, Copy, PartialEq, Eq)]
pub enum EditorPreviewQuality {
    #[serde(rename = "144p")]
    P144,
    #[serde(rename = "360p", alias = "quarter")]
    P360,
    #[serde(rename = "480p")]
    P480,
    #[serde(rename = "540p")]
    P540,
    #[default]
    #[serde(rename = "720p", alias = "half")]
    P720,
    #[serde(rename = "1080p", alias = "full")]
    P1080,
    #[serde(rename = "1440p")]
    P1440,
    #[serde(rename = "2160p")]
    P2160,
    #[serde(rename = "original")]
    Original,
}

impl EditorPreviewQuality {
    pub fn short_side(self) -> Option<u32> {
        match self {
            Self::P144 => Some(144),
            Self::P360 => Some(360),
            Self::P480 => Some(480),
            Self::P540 => Some(540),
            Self::P720 => Some(720),
            Self::P1080 => Some(1080),
            Self::P1440 => Some(1440),
            Self::P2160 => Some(2160),
            Self::Original => None,
        }
    }
}

#[derive(Serialize, Deserialize, Type, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PreviewCanvasConfiguration {
    pub aspect_ratio: Option<AspectRatio>,
    pub crop: Option<Crop>,
    pub padding: f64,
}

impl From<&ProjectConfiguration> for PreviewCanvasConfiguration {
    fn from(project: &ProjectConfiguration) -> Self {
        Self {
            aspect_ratio: project.aspect_ratio.clone(),
            crop: project.background.crop.clone(),
            padding: project.background.padding,
        }
    }
}

#[derive(Serialize, Deserialize, Type, Debug, Clone, Copy, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewResolutionOption {
    pub quality: EditorPreviewQuality,
    pub resolution_base: XY<u32>,
    pub output_size: XY<u32>,
    pub available: bool,
    pub limited: bool,
}

pub fn resolve_preview_resolution(
    options: &RenderOptions,
    canvas: &PreviewCanvasConfiguration,
    quality: EditorPreviewQuality,
    max_dimension: u32,
) -> Result<PreviewResolutionOption, String> {
    let choices = preview_resolutions(options, canvas, max_dimension)?;
    choices
        .iter()
        .find(|choice| choice.quality == quality && choice.available)
        .or_else(|| {
            choices
                .iter()
                .find(|choice| choice.quality == EditorPreviewQuality::Original && choice.available)
        })
        .copied()
        .ok_or_else(|| "Preview resolutions unavailable".into())
}

pub fn preview_resolutions(
    options: &RenderOptions,
    canvas: &PreviewCanvasConfiguration,
    max_dimension: u32,
) -> Result<Vec<PreviewResolutionOption>, String> {
    let source = canvas.crop.as_ref().map_or(options.screen_size, |v| v.size);
    if source.x == 0
        || source.y == 0
        || source.x > 65536
        || source.y > 65536
        || !canvas.padding.is_finite()
        || !(-100.0..=10000.0).contains(&canvas.padding)
        || max_dimension < 4
    {
        return Err("Invalid preview canvas dimensions".into());
    }
    let max_dimension = max_dimension.min(8192) & !3;
    let mut project = ProjectConfiguration {
        aspect_ratio: canvas.aspect_ratio.clone(),
        ..Default::default()
    };
    project.background.crop = canvas.crop.clone();
    project.background.padding = canvas.padding;
    let (native_width, native_height) = ProjectUniforms::get_base_size(options, &project);
    let original_base = XY::new(
        native_width.min(max_dimension),
        native_height.min(max_dimension),
    );
    let output = |base| {
        let (x, y) = ProjectUniforms::get_output_size(options, &project, base);
        XY::new(x, y)
    };
    let original_size = output(original_base);
    let qualities = [
        EditorPreviewQuality::P144,
        EditorPreviewQuality::P360,
        EditorPreviewQuality::P480,
        EditorPreviewQuality::P540,
        EditorPreviewQuality::P720,
        EditorPreviewQuality::P1080,
        EditorPreviewQuality::P1440,
        EditorPreviewQuality::P2160,
        EditorPreviewQuality::Original,
    ];
    Ok(qualities
        .into_iter()
        .map(|quality| {
            let resolution_base = match quality.short_side() {
                Some(pixels) if native_width > native_height => XY::new(max_dimension, pixels),
                Some(pixels) => XY::new(pixels, max_dimension),
                None => original_base,
            };
            let output_size = output(resolution_base);
            let available = quality.short_side().is_none_or(|pixels| {
                pixels <= original_size.x.min(original_size.y)
                    && output_size.x.min(output_size.y) == pixels
                    && output_size.x <= original_size.x
                    && output_size.y <= original_size.y
            });
            PreviewResolutionOption {
                quality,
                resolution_base,
                output_size,
                available,
                limited: quality == EditorPreviewQuality::Original
                    && (native_width > max_dimension || native_height > max_dimension),
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options(x: u32, y: u32) -> RenderOptions {
        RenderOptions {
            camera_size: None,
            screen_size: XY::new(x, y),
            preserve_screen_alpha: false,
        }
    }

    #[test]
    fn stored_percentages_migrate_to_canonical_pixel_choices() {
        for (legacy, current) in [("quarter", "360p"), ("half", "720p"), ("full", "1080p")] {
            let quality: EditorPreviewQuality = serde_json::from_value(legacy.into()).unwrap();
            assert_eq!(serde_json::to_value(quality).unwrap(), current);
        }
        assert_eq!(EditorPreviewQuality::default(), EditorPreviewQuality::P720);
    }

    #[test]
    fn choices_use_the_renderers_real_aligned_output_for_every_canvas_ratio() {
        let aspects = [
            None,
            Some(AspectRatio::Wide),
            Some(AspectRatio::Vertical),
            Some(AspectRatio::Square),
            Some(AspectRatio::WideScreen),
            Some(AspectRatio::Ultrawide),
            Some(AspectRatio::Cinema),
        ];
        for (width, height) in [(3840, 2160), (2160, 3840), (640, 480), (1000, 560), (1, 1)] {
            for aspect_ratio in &aspects {
                for padding in [0.0, 10.0, 14.1, 50.0] {
                    let canvas = PreviewCanvasConfiguration {
                        aspect_ratio: aspect_ratio.clone(),
                        crop: None,
                        padding,
                    };
                    let options = options(width, height);
                    let choices = preview_resolutions(&options, &canvas, 8192).unwrap();
                    let original = choices.last().unwrap();
                    let mut project = ProjectConfiguration {
                        aspect_ratio: aspect_ratio.clone(),
                        ..Default::default()
                    };
                    project.background.padding = padding;
                    for choice in choices.iter().filter(|v| v.available) {
                        let size = ProjectUniforms::get_output_size(
                            &options,
                            &project,
                            choice.resolution_base,
                        );
                        assert_eq!(choice.output_size, XY::new(size.0, size.1));
                        assert_eq!(size.0 % 4, 0);
                        assert_eq!(size.1 % 2, 0);
                        assert!(
                            size.0 <= original.output_size.x && size.1 <= original.output_size.y
                        );
                        if let Some(short) = choice.quality.short_side() {
                            assert_eq!(size.0.min(size.1), short);
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn crop_source_and_device_limits_disable_unavailable_choices() {
        let mut canvas = PreviewCanvasConfiguration::from(&ProjectConfiguration::default());
        canvas.padding = 0.0;
        canvas.crop = Some(Crop {
            position: XY::new(0, 0),
            size: XY::new(320, 240),
        });
        let choices = preview_resolutions(&options(3840, 2160), &canvas, 8192).unwrap();
        assert!(
            choices
                .iter()
                .find(|v| v.quality == EditorPreviewQuality::P144)
                .unwrap()
                .available
        );
        assert!(
            !choices
                .iter()
                .find(|v| v.quality == EditorPreviewQuality::P360)
                .unwrap()
                .available
        );
        assert_eq!(choices.last().unwrap().output_size, XY::new(320, 240));
        canvas.crop = None;
        let choices = preview_resolutions(&options(12000, 9000), &canvas, 4096).unwrap();
        let original = choices.last().unwrap();
        assert!(original.limited);
        assert_eq!(original.output_size, XY::new(4096, 3072));
        assert!(
            choices
                .iter()
                .all(|v| !v.available || v.output_size.x.max(v.output_size.y) <= 4096)
        );
        assert!(preview_resolutions(&options(0, 0), &canvas, 8192).is_err());
        canvas.padding = f64::NAN;
        assert!(preview_resolutions(&options(1920, 1080), &canvas, 8192).is_err());
    }
}
