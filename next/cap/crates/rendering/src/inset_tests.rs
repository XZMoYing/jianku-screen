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
