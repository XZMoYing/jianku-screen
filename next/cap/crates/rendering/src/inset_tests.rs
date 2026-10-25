use super::*;
use cap_project::InsetStyle;

#[test]
fn inset_layouts_preserve_aspect_and_generate_screenshot_geometry() {
    let mut cases = Vec::new();
    for source in [
        XY::new(1920, 1080),
        XY::new(1080, 1920),
        XY::new(2560, 1600),
    ] {
        for aspect in [
            None,
            Some(cap_project::AspectRatio::Wide),
            Some(cap_project::AspectRatio::Square),
        ] {
            for style in [
                FrameStyle::None,
                FrameStyle::MacOS,
                FrameStyle::Windows,
                FrameStyle::Browser,
                FrameStyle::Macbook,
                FrameStyle::Phone,
                FrameStyle::Tablet,
            ] {
                for amount in [0, 24, 100] {
                    let options = RenderOptions {
                        screen_size: source,
                        camera_size: None,
                        preserve_screen_alpha: false,
                    };
                    let mut project = ProjectConfiguration::default();
                    project.aspect_ratio = aspect.clone();
                    project.background.padding = 20.0;
                    project.background.inset = amount;
                    project.background.frame = Some(FrameConfiguration {
                        style,
                        ..Default::default()
                    });
                    project.background.display_position = Some(XY::new(0.55, 0.45));
                    if source.x == 2560 {
                        project.background.crop = Some(Crop {
                            position: XY::new(100, 150),
                            size: XY::new(1800, 1000),
                        });
                    }
                    let resolution = XY::new(1280, 720);
                    let output = ProjectUniforms::get_output_size(&options, &project, resolution);
                    let layout = ProjectUniforms::display_layout(&options, &project, resolution);
                    let crop = ProjectUniforms::get_crop(&options, &project);
                    if amount > 0 || style != FrameStyle::None {
                        assert!(
                            (layout.content_size.x / layout.content_size.y
                                - f64::from(crop.size.x) / f64::from(crop.size.y))
                            .abs()
                                < 1e-9
                        );
                    }
                    let gap = layout.content_size.x.min(layout.content_size.y) * f64::from(amount)
                        / 1080.0;
                    assert!(layout.content_offset.x - gap >= layout.outer_offset.x - 1e-6);
                    assert!(layout.content_offset.y - gap >= layout.outer_offset.y - 1e-6);
                    assert!(
                        layout.content_offset.x + layout.content_size.x + gap
                            <= layout.outer_offset.x + layout.outer_size.x + 1e-6
                    );
                    assert!(
                        layout.content_offset.y + layout.content_size.y + gap
                            <= layout.outer_offset.y + layout.outer_size.y + 1e-6
                    );
                    cases.push(serde_json::json!({
                        "frameSize": {"width": output.0, "height": output.1},
                        "imageSize": {"width": source.x, "height": source.y},
                        "padding": project.background.padding, "crop": project.background.crop,
                        "aspectRatio": project.aspect_ratio,
                        "decoration": {"inset": amount, "frame": project.background.frame, "displayPosition": project.background.display_position},
                        "expected": {"offset": {"x": layout.content_offset.x, "y": layout.content_offset.y}, "size": {"width": layout.content_size.x, "height": layout.content_size.y}}
                    }));
                }
            }
        }
    }
    if let Some(path) = std::env::var_os("JIANKU_INSET_LAYOUT_OUTPUT") {
        let file = std::fs::File::create(path).unwrap();
        let mut writer = serde_json::Serializer::with_formatter(
            file,
            serde_json::ser::PrettyFormatter::with_indent(b"\t"),
        );
        serde::Serialize::serialize(&cases, &mut writer).unwrap();
        std::io::Write::write_all(&mut writer.into_inner(), b"\n").unwrap();
    }
}

async fn constants() -> RenderVideoConstants {
    let recording: RecordingMeta = serde_json::from_value(serde_json::json!({
        "pretty_name": "inset-render-test", "display": {"path": "display.mp4", "fps": 60},
        "camera": null, "audio": null, "cursor": null
    }))
    .unwrap();
    let meta = recording.studio_meta().unwrap().clone();
    RenderVideoConstants::new_with_options(
        RenderOptions {
            screen_size: XY::new(640, 360),
            camera_size: None,
            preserve_screen_alpha: false,
        },
        recording,
        meta,
    )
    .await
    .unwrap()
}

#[tokio::test]
async fn inset_gpu_pixels_alpha_color_and_live_output_match() {
    let constants = constants().await;
    let events = CursorEvents::default();
    let frames = DecodedSegmentFrames {
        screen_size: XY::new(640, 360),
        screen_frame: Some(DecodedFrame::new(
            [230, 20, 30, 255].repeat(640 * 360),
            640,
            360,
        )),
        camera_frame: None,
        segment_time: 0.0,
        recording_time: 0.0,
        segment_has_camera: false,
    };
    let mut project = ProjectConfiguration::default();
    project.background.source = cap_project::BackgroundSource::Color {
        value: [255; 3],
        alpha: 255,
    };
    project.background.shadow = 0.0;
    project.cursor.hide = true;
    project.camera.hide = true;
    project.screen_motion_blur = 0.0;
    let mut renderer = FrameRenderer::new(&constants);
    let mut layers = RendererLayers::new(&constants.device, &constants.queue);
    let motion = live::LiveMotion::new(
        constants.options.screen_size,
        &project.cursor,
        project.screen_movement_spring,
    );
    let mut zero = None;
    for (amount, color, opacity, expected) in [
        (0, [0, 0, 0], 50.0, None),
        (0, [0, 255, 0], 100.0, None),
        (54, [0, 0, 0], 50.0, Some([127, 127, 127])),
        (54, [0, 0, 240], 100.0, Some([0, 0, 240])),
        (54, [0, 0, 0], 0.0, Some([255, 255, 255])),
    ] {
        project.background.inset = amount;
        project.background.inset_style = Some(InsetStyle { color, opacity });
        let timeline =
            ZoomTransformTimeline::from_project(&project, &events, 1.0, frames.screen_size);
        let uniforms = ProjectUniforms::new(
            &constants,
            &project,
            0,
            60,
            XY::new(640, 360),
            &events,
            &frames,
            1.0,
            &timeline,
        );
        let frame = renderer
            .render_immediate(frames.clone(), uniforms.clone(), &events, true, &mut layers)
            .await
            .unwrap();
        let live_uniforms = ProjectUniforms::new_live(
            &constants,
            LiveRenderInput {
                project: &project,
                frame_number: 0,
                fps: 60,
                output_size: XY::new(640, 360),
                events: &events,
                frames: &frames,
                motion: &motion,
                cursor_id: "default",
            },
        );
        let live_frame = renderer
            .render_immediate(frames.clone(), live_uniforms, &events, true, &mut layers)
            .await
            .unwrap();
        assert_eq!(
            frame.data, live_frame.data,
            "live/editor composition differs"
        );
        if amount == 0 {
            assert!(uniforms.inset.is_none());
            if let Some(previous) = &zero {
                assert_eq!(&frame.data, previous);
            } else {
                zero = Some(frame.data.clone());
            }
        }
        if let Some(expected) = expected {
            let outer = uniforms.inset.unwrap().composite.target_bounds;
            let inner = uniforms.display.target_bounds;
            let x = ((outer[0] + inner[0]) * 0.5) as usize;
            let y = ((inner[1] + inner[3]) * 0.5) as usize;
            let offset = y * frame.padded_bytes_per_row as usize + x * 4;
            for (actual, expected) in frame.data[offset..offset + 3].iter().zip(expected) {
                assert!(
                    actual.abs_diff(expected) <= 1,
                    "unexpected inset pixel {:?}",
                    &frame.data[offset..offset + 4]
                );
            }
            let center = 180 * frame.padded_bytes_per_row as usize + 320 * 4;
            assert_eq!(&frame.data[center..center + 4], &[230, 20, 30, 255]);
        }
    }
}

fn zoom_probe_project() -> ProjectConfiguration {
    let project: ProjectConfiguration = serde_json::from_value(serde_json::json!({
        "background": {
            "source": {"type": "color", "value": [235, 230, 213], "alpha": 255},
            "padding": 14.0, "rounding": 7.5, "roundingType": "squircle",
            "inset": 100, "insetStyle": {"color": [20, 60, 90], "opacity": 100.0},
            "shadow": 60.0, "advancedShadow": {"size": 25.0, "opacity": 30.0, "blur": 30.0},
            "frame": {"style": "browser", "theme": "light", "url": "jianku.local", "title": "合成示例"}
        },
        "camera": {"hide": true}, "cursor": {"hide": true},
        "screenMovementSpring": {"stiffness": 200.0, "damping": 40.0, "mass": 2.25},
        "timeline": {
            "segments": [{"recordingSegment": 0, "timescale": 1.0, "start": 0.0, "end": 6.0}],
            "zoomSegments": [{"start": 1.0, "end": 4.0, "amount": 1.5, "mode": "auto"}]
        }
    })).unwrap();
    project
}

#[test]
fn inset_zoom_blur_pivot_is_stable_on_fractional_layouts() {
    let events = CursorEvents::default();
    let mut project = zoom_probe_project();
    let options = RenderOptions {
        screen_size: XY::new(640, 360),
        camera_size: None,
        preserve_screen_alpha: false,
    };
    let mut timeline =
        ZoomTransformTimeline::from_project(&project, &events, 6.0, options.screen_size);
    timeline.precompute();
    for resolution in [
        XY::new(1248, 702),
        XY::new(1280, 720),
        XY::new(2560, 1600),
        XY::new(3840, 2160),
    ] {
        for padding in [0.0, 14.0, 60.0] {
            project.background.padding = padding;
            let layout = ProjectUniforms::display_layout(&options, &project, resolution);
            for number in (61..115).chain(241..305) {
                let time = number as f32 / 60.0;
                let previous_time = time - 1.0 / 60.0;
                let bounds = |zoom| {
                    let (start, end) = ProjectUniforms::display_bounds(
                        &zoom,
                        Coord::new(layout.content_offset),
                        Coord::new(layout.content_size),
                    );
                    MotionBounds::new(start, end)
                };
                let current = bounds(timeline.sample(time));
                let previous = bounds(timeline.sample(previous_time));
                let blur = ProjectUniforms::compute_display_motion_blur(
                    current, previous, true, 1.0, 0.0, 1.0,
                );
                if blur.descriptor.mode == MotionBlurMode::Zoom {
                    for actual in blur.descriptor.zoom_center_uv {
                        assert!(
                            (actual - 0.4999).abs() < 0.00002,
                            "frame {number}, resolution {resolution:?}, padding {padding}: blur pivot jumped to {:?}",
                            blur.descriptor.zoom_center_uv
                        );
                    }
                }
            }
        }
    }
}

#[tokio::test]
async fn inset_zoom_tracks_static_marker_geometry() {
    let constants = constants().await;
    let events = CursorEvents::default();
    let mut project = zoom_probe_project();
    let mut pixels = [255, 255, 255, 255].repeat(640 * 360);
    for y in 0..360 {
        for x in 254..258 {
            let offset = (y * 640 + x) * 4;
            pixels[offset..offset + 4].copy_from_slice(&[255, 0, 0, 255]);
        }
    }
    let frames = DecodedSegmentFrames {
        screen_size: XY::new(640, 360),
        screen_frame: Some(DecodedFrame::new(pixels, 640, 360)),
        camera_frame: None,
        segment_time: 0.0,
        recording_time: 0.0,
        segment_has_camera: false,
    };
    let output = std::env::var_os("JIANKU_ZOOM_PROBE_OUTPUT").map(std::path::PathBuf::from);
    if let Some(output) = &output {
        std::fs::create_dir_all(output).unwrap();
    }
    let mut rows = Vec::new();
    for blur in [0.0, 1.0] {
        project.screen_motion_blur = blur;
        let mut timeline =
            ZoomTransformTimeline::from_project(&project, &events, 6.0, frames.screen_size);
        timeline.precompute();
        let mut renderer = FrameRenderer::new(&constants);
        let mut layers = RendererLayers::new(&constants.device, &constants.queue);
        let mut previous_marker: Option<(u32, f64)> = None;
        for number in (57..115).chain(238..305) {
            let uniforms = ProjectUniforms::new(
                &constants,
                &project,
                number,
                60,
                XY::new(1280, 720),
                &events,
                &frames,
                6.0,
                &timeline,
            );
            if uniforms.display.motion_blur_params[0] == MotionBlurMode::Zoom.as_f32() {
                let pivot = uniforms.display.motion_blur_zoom_center;
                for actual in pivot {
                    assert!(
                        (actual - 0.4999).abs() < 0.00002,
                        "unstable blur center at {number}: {pivot:?}"
                    );
                }
                let display = uniforms.display;
                let accessories = [
                    uniforms.inset.unwrap().composite,
                    uniforms.frame_chrome.as_ref().unwrap().composite,
                ];
                for accessory in accessories {
                    for (axis, focus) in pivot.into_iter().enumerate() {
                        let expected =
                            display.target_bounds[axis] + focus * display.target_size[axis];
                        let actual = accessory.target_bounds[axis]
                            + accessory.motion_blur_zoom_center[axis] * accessory.target_size[axis];
                        assert!(
                            (actual - expected).abs() < 0.0002,
                            "accessory blur pivot is detached at {number}"
                        );
                    }
                }
            }
            let frame = renderer
                .render_immediate(frames.clone(), uniforms.clone(), &events, true, &mut layers)
                .await
                .unwrap();
            let mut weighted = 0.0;
            let mut weight = 0.0;
            for y in 290..430 {
                for x in 440..600 {
                    let offset = y * frame.padded_bytes_per_row as usize + x * 4;
                    let signal =
                        f64::from(frame.data[offset].saturating_sub(frame.data[offset + 1]));
                    weight += signal;
                    weighted += signal * (x as f64 + 0.5);
                }
            }
            assert!(weight > 0.0);
            let center = weighted / weight;
            if let Some((previous_number, previous_center)) = previous_marker {
                let direction = if number > 60 && number < 115 {
                    Some(-1.0)
                } else if number > 240 {
                    Some(1.0)
                } else {
                    None
                };
                if number == previous_number + 1
                    && let Some(direction) = direction
                {
                    assert!(
                        (center - previous_center) * direction > -0.2,
                        "marker reversed: {previous_number}:{previous_center} -> {number}:{center}, blur={blur}"
                    );
                }
            }
            previous_marker = Some((number, center));
            rows.push(serde_json::json!({
                "frame": number, "blur": blur, "markerCenter": center,
                "displayBounds": uniforms.display.target_bounds,
                "insetBounds": uniforms.inset.unwrap().composite.target_bounds,
                "chromeBounds": uniforms.frame_chrome.as_ref().unwrap().composite.target_bounds,
                "blurCenter": uniforms.display.motion_blur_zoom_center,
                "blurParams": uniforms.display.motion_blur_params
            }));
            if let Some(output) = output.as_ref().filter(|_| {
                [57, 60, 61, 62, 68, 69, 70, 80, 240, 241, 248, 250, 270, 300].contains(&number)
            }) {
                let image: Vec<u8> = frame
                    .data
                    .chunks_exact(frame.padded_bytes_per_row as usize)
                    .flat_map(|row| row[..1280 * 4].iter().copied())
                    .collect();
                image::save_buffer(
                    output.join(format!("blur-{blur}-frame-{number:03}.png")),
                    &image,
                    1280,
                    720,
                    image::ColorType::Rgba8,
                )
                .unwrap();
            }
        }
    }
    if let Some(output) = output {
        std::fs::write(
            output.join("motion.json"),
            serde_json::to_vec_pretty(&rows).unwrap(),
        )
        .unwrap();
    }
}
