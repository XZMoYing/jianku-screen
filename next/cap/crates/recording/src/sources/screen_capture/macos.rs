use super::*;
use crate::{
    ChannelAudioSourceConfig,
    output_pipeline::{
        self, AudioFrame, ChannelAudioSource, ChannelVideoSource, ChannelVideoSourceConfig,
        SetupCtx,
    },
};
use anyhow::{Context, anyhow};
use cap_timestamp::Timestamp;
use cidre::*;
use futures::{FutureExt as _, channel::mpsc, future::BoxFuture};
use std::{
    ptr,
    sync::{
        Arc, Mutex,
        atomic::{self, AtomicBool, AtomicU32, AtomicU64},
    },
    time::{Duration, Instant},
};
use tokio::{select, sync::broadcast};
use tokio_util::{
    future::FutureExt as _,
    sync::{CancellationToken, DropGuard},
};
use tracing::{debug, error, info, warn};

const MAX_CAPTURE_RESTARTS: u32 = 3;
const RESTART_DELAY: Duration = Duration::from_secs(2);

pub type WindowGeometryState = Arc<Mutex<Option<WindowCaptureGeometry>>>;

#[derive(Clone, Copy, Debug)]
pub struct WindowCaptureGeometry {
    screen: LogicalBounds,
    viewport: LogicalBounds,
}

impl WindowCaptureGeometry {
    pub fn project(&self, x: f64, y: f64) -> (f64, f64) {
        (
            self.viewport.position().x()
                + (x - self.screen.position().x()) / self.screen.size().width()
                    * self.viewport.size().width(),
            self.viewport.position().y()
                + (y - self.screen.position().y()) / self.screen.size().height()
                    * self.viewport.size().height(),
        )
    }
}

fn frame_rect(value: &cf::Plist) -> Option<LogicalBounds> {
    let dict = value.try_as_dictionary()?;
    let number = |key: &cf::String| dict.get(key)?.try_as_number()?.to_f64();
    let (x, y, width, height) = (
        number(ns::str!(c"X").as_cf())?,
        number(ns::str!(c"Y").as_cf())?,
        number(ns::str!(c"Width").as_cf())?,
        number(ns::str!(c"Height").as_cf())?,
    );
    (x.is_finite()
        && y.is_finite()
        && width > 0.0
        && height > 0.0
        && width.is_finite()
        && height.is_finite())
    .then_some(LogicalBounds::new(
        LogicalPosition::new(x, y),
        LogicalSize::new(width, height),
    ))
}

fn update_window_geometry(sample: &cm::SampleBuf, state: &WindowGeometryState) {
    if !api::macos_available("13.1") {
        return;
    }
    let geometry = (|| {
        let info = sample.attaches(false)?.iter().next()?;
        let screen = frame_rect(info.get(unsafe { sc::FrameInfo::screen_rect() }?.as_cf())?)?;
        let content = frame_rect(info.get(sc::FrameInfo::content_rect().as_cf())?)?;
        let scale = info
            .get(sc::FrameInfo::scale_factor().as_cf())?
            .try_as_number()?
            .to_f64()?;
        let image = sample.image_buf()?;
        if !scale.is_finite() || scale <= 0.0 || image.width() == 0 || image.height() == 0 {
            return None;
        }
        Some(WindowCaptureGeometry {
            screen,
            viewport: LogicalBounds::new(
                LogicalPosition::new(
                    content.position().x() * scale / image.width() as f64,
                    content.position().y() * scale / image.height() as f64,
                ),
                LogicalSize::new(
                    content.size().width() * scale / image.width() as f64,
                    content.size().height() * scale / image.height() as f64,
                ),
            ),
        })
    })();
    if let Some(geometry) = geometry
        && let Ok(mut current) = state.lock()
    {
        if current.is_none() {
            info!(?geometry, "Received isolated window capture geometry");
        }
        *current = Some(geometry);
    }
}

impl Config {
    fn content_filter(
        &self,
        content: arc::R<sc::ShareableContent>,
        excluded_windows: &[WindowId],
        capture_phase: &'static str,
    ) -> anyhow::Result<arc::R<sc::ContentFilter>> {
        if let Some(id) = &self.window {
            let native_id = id.to_string().parse::<u32>()?;
            let windows = content.windows();
            let window = windows
                .iter()
                .find(|window| window.id() == native_id)
                .ok_or_else(|| anyhow!("Capture target window unavailable: {id}"))?;
            return Ok(sc::ContentFilter::with_desktop_independent_window(window));
        }

        let display = Display::from_id(&self.display)
            .ok_or_else(|| SourceError::NoDisplay(self.display.clone()))?;
        let excluded = excluded_shareable_windows(excluded_windows, &content, capture_phase);
        display
            .raw_handle()
            .as_content_filter_excluding_windows(content, excluded)
            .ok_or_else(|| SourceError::AsContentFilter.into())
    }

    fn apply_capture_region(&self, settings: &mut sc::StreamCfg) {
        if self.window.is_some() {
            // A window filter already has window-local coordinates. Reusing the
            // display crop clips the window again and can expose the wrong region.
            if api::macos_available("14.0") {
                unsafe { settings.set_ignore_shadows_single_window(true) };
                unsafe { settings.set_ignore_global_clip_single_window(true) };
            }
            settings.set_scales_to_fit(true);
        } else if let Some(bounds) = self.crop_bounds {
            settings.set_src_rect(cg::Rect::new(
                bounds.position().x(),
                bounds.position().y(),
                bounds.size().width(),
                bounds.size().height(),
            ));
        }
    }
}

fn excluded_shareable_windows(
    excluded_windows: &[WindowId],
    content: &sc::ShareableContent,
    capture_phase: &'static str,
) -> Vec<arc::R<sc::Window>> {
    if excluded_windows.is_empty() {
        return Vec::new();
    }

    let windows = content.windows();
    let mut collected = Vec::new();
    for window_id in excluded_windows {
        let Ok(native_id) = window_id.to_string().parse::<u32>() else {
            warn!(%window_id, capture_phase, "Excluded window has an invalid native id");
            continue;
        };

        // New or protected panels can be absent from the CG on-screen list
        // while still belonging to the snapshot used to build this filter.
        if let Some(window) = windows.iter().find(|window| window.id() == native_id) {
            collected.push(window.retained());
        } else {
            warn!(
                %window_id,
                capture_phase,
                "Excluded window missing from ScreenCaptureKit shareable content"
            );
        }
    }

    info!(
        capture_phase,
        configured_excluded_windows = excluded_windows.len(),
        mapped_excluded_windows = collected.len(),
        "Mapped ScreenCaptureKit excluded windows"
    );
    collected
}

#[cfg(test)]
mod window_capture_tests {
    use super::*;

    fn config(isolated: bool) -> Config {
        Config {
            display: "1".parse().unwrap(),
            crop_bounds: Some(LogicalBounds::new(
                LogicalPosition::new(320.0, 180.0),
                LogicalSize::new(720.0, 450.0),
            )),
            window: isolated.then(|| "42".parse().unwrap()),
            fps: 60,
            show_cursor: false,
        }
    }

    #[test]
    fn overlapping_content_mode_preserves_the_display_region() {
        let mut settings = sc::StreamCfg::new();
        config(false).apply_capture_region(&mut settings);
        assert_eq!(
            settings.src_rect(),
            cg::Rect::new(320.0, 180.0, 720.0, 450.0)
        );
    }

    #[test]
    fn isolated_window_does_not_reapply_the_display_crop() {
        let mut settings = sc::StreamCfg::new();
        let full_source = settings.src_rect();
        config(true).apply_capture_region(&mut settings);
        assert_eq!(settings.src_rect(), full_source);
        assert!(settings.scales_to_fit());
    }

    #[test]
    fn cursor_follows_captured_window_coordinates_and_letterboxing() {
        let geometry = WindowCaptureGeometry {
            screen: LogicalBounds::new(
                LogicalPosition::new(-1000.0, 80.0),
                LogicalSize::new(400.0, 600.0),
            ),
            viewport: LogicalBounds::new(
                LogicalPosition::new(0.25, 0.0),
                LogicalSize::new(0.5, 1.0),
            ),
        };
        assert_eq!(geometry.project(-1000.0, 80.0), (0.25, 0.0));
        assert_eq!(geometry.project(-800.0, 380.0), (0.5, 0.5));
        assert_eq!(geometry.project(-600.0, 680.0), (0.75, 1.0));
        assert!(geometry.project(-1200.0, 80.0).0 < 0.25);
    }
}

struct FrameScaler {
    session: arc::R<cidre::vt::PixelTransferSession>,
    pool: arc::R<cv::PixelBufPool>,
}

unsafe impl Send for FrameScaler {}

impl FrameScaler {
    fn new(expected_width: usize, expected_height: usize) -> Option<Self> {
        let mut session = cidre::vt::PixelTransferSession::new().ok()?;
        session.set_scaling_letter_box().ok()?;
        session.set_realtime(true).ok()?;
        let pool = create_pixel_buffer_pool(expected_width, expected_height)?;

        Some(Self { session, pool })
    }

    fn scale_frame(&self, src_sample_buf: &cm::SampleBuf) -> Option<arc::R<cm::SampleBuf>> {
        let src_image_buf = src_sample_buf.image_buf()?;
        let dst_buf = self.pool.pixel_buf().ok()?;

        self.session.transfer(src_image_buf, &dst_buf).ok()?;

        let format_desc = cm::VideoFormatDesc::with_image_buf(&dst_buf).ok()?;
        let timing = src_sample_buf.timing_info(0).ok()?;

        cm::SampleBuf::with_image_buf(&dst_buf, true, None, ptr::null(), &format_desc, &timing).ok()
    }
}

fn get_pixel_buffer_pool_size() -> usize {
    std::env::var("CAP_PIXEL_BUFFER_POOL_SIZE")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(20)
}

fn create_pixel_buffer_pool(width: usize, height: usize) -> Option<arc::R<cv::PixelBufPool>> {
    let min_count = get_pixel_buffer_pool_size();

    let min_count_num = cf::Number::from_usize(min_count);
    let width_num = cf::Number::from_usize(width);
    let height_num = cf::Number::from_usize(height);
    let io_props = cf::Dictionary::new();

    let pool_attr_keys: [&cf::Type; 1] =
        [cv::pixel_buffer_pool::keys::minimum_buffer_count().as_ref()];
    let pool_attr_values: [&cf::Type; 1] = [min_count_num.as_ref()];
    let pool_attrs = cf::Dictionary::with_keys_values(&pool_attr_keys, &pool_attr_values)?;

    let pixel_buf_attr_keys: [&cf::Type; 5] = [
        cv::pixel_buffer::keys::pixel_format().as_ref(),
        cv::pixel_buffer::keys::width().as_ref(),
        cv::pixel_buffer::keys::height().as_ref(),
        cv::pixel_buffer::keys::io_surf_props().as_ref(),
        cv::pixel_buffer::keys::metal_compatibility().as_ref(),
    ];
    let pixel_buf_attr_values: [&cf::Type; 5] = [
        cv::PixelFormat::_420V.to_cf_number().as_ref(),
        width_num.as_ref(),
        height_num.as_ref(),
        io_props.as_ref(),
        cf::Boolean::value_true().as_ref(),
    ];
    let pixel_buf_attrs =
        cf::Dictionary::with_keys_values(&pixel_buf_attr_keys, &pixel_buf_attr_values)?;

    debug!(min_count, width, height, "Pixel buffer pool initialized");
    cv::PixelBufPool::new(Some(pool_attrs.as_ref()), Some(pixel_buf_attrs.as_ref())).ok()
}

fn get_screen_buffer_size() -> usize {
    std::env::var("CAP_SCREEN_BUFFER_SIZE")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(15)
}

fn get_max_queue_depth() -> isize {
    std::env::var("CAP_MAX_QUEUE_DEPTH")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(8)
}

#[derive(Debug)]
pub struct CMSampleBufferCapture;

impl ScreenCaptureFormat for CMSampleBufferCapture {
    type VideoFormat = cidre::arc::R<cidre::cm::SampleBuf>;

    fn pixel_format() -> ffmpeg::format::Pixel {
        ffmpeg::format::Pixel::NV12
    }

    fn audio_info() -> AudioInfo {
        AudioInfo::new(
            ffmpeg::format::Sample::F32(ffmpeg::format::sample::Type::Planar),
            48_000,
            2,
        )
        .expect("static F32/48kHz/stereo audio config")
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SourceError {
    #[error("NoDisplay: Id '{0}'")]
    NoDisplay(DisplayId),
    #[error("AsContentFilter")]
    AsContentFilter,
}

pub struct VideoFrame {
    pub sample_buf: arc::R<cm::SampleBuf>,
    pub timestamp: Timestamp,
}

impl output_pipeline::VideoFrame for VideoFrame {
    fn timestamp(&self) -> Timestamp {
        self.timestamp
    }

    fn duplicate(&self) -> Option<Self> {
        Some(Self {
            sample_buf: self.sample_buf.clone(),
            timestamp: self.timestamp,
        })
    }
}

impl ScreenCaptureConfig<CMSampleBufferCapture> {
    pub fn window_geometry(&self) -> Option<WindowGeometryState> {
        self.config
            .window
            .as_ref()
            .map(|_| self.window_geometry.clone())
    }

    pub async fn to_sources(
        &self,
    ) -> anyhow::Result<(VideoSourceConfig, Option<SystemAudioSourceConfig>)> {
        let (error_tx, error_rx) = broadcast::channel(1);
        let buffer_size = get_screen_buffer_size();
        debug!(buffer_size = buffer_size, "Screen capture buffer size");
        let (video_tx, video_rx) = flume::bounded(buffer_size);
        let drop_counter: Arc<AtomicU64> = Arc::new(AtomicU64::new(0));
        let (mut audio_tx, audio_rx) = if self.system_audio {
            let (tx, rx) = mpsc::channel(128);
            (Some(tx), Some(rx))
        } else {
            (None, None)
        };
        let system_audio_drop_counter: Arc<AtomicU64> = Arc::new(AtomicU64::new(0));
        let system_audio_frame_counter: Arc<AtomicU64> = Arc::new(AtomicU64::new(0));

        let content_filter = self.config.content_filter(
            self.shareable_content.clone(),
            &self.excluded_windows,
            "initial",
        )?;

        debug!("SCK content filter: {:?}", content_filter);

        let size = PhysicalSize::new(self.video_info.width as f64, self.video_info.height as f64);

        debug!("size: {:?}", size);

        let max_queue_depth = get_max_queue_depth();
        let queue_depth =
            ((self.config.fps as f32 / 30.0 * 5.0).ceil() as isize).clamp(3, max_queue_depth);
        debug!(
            queue_depth = queue_depth,
            max_queue_depth = max_queue_depth,
            "Screen capture queue depth"
        );

        let mut settings = scap_screencapturekit::StreamCfgBuilder::default()
            .with_width(size.width() as usize)
            .with_height(size.height() as usize)
            .with_fps(self.config.fps as f32)
            .with_shows_cursor(self.config.show_cursor)
            .with_captures_audio(self.system_audio)
            .with_queue_depth(queue_depth)
            .build();

        settings.set_pixel_format(cv::PixelFormat::_420V);
        settings.set_color_space_name(cg::color_space::names::srgb());

        self.config.apply_capture_region(&mut settings);
        cap_fail::fail_err!(
            "macos::ScreenCaptureActor::new",
            ns::Error::with_domain(ns::ErrorDomain::os_status(), 69420, None)
        );

        let video_frame_counter: Arc<AtomicU32> = Arc::new(AtomicU32::new(0));

        let expected_width = self.video_info.width as usize;
        let expected_height = self.video_info.height as usize;
        let frame_scaler: Arc<Mutex<Option<FrameScaler>>> = Arc::new(Mutex::new(None));
        let scaling_logged = Arc::new(AtomicBool::new(false));
        let scaled_frame_count = Arc::new(AtomicU64::new(0));

        let (stall_health_tx, stall_health_rx) =
            tokio::sync::mpsc::channel::<output_pipeline::PipelineHealthEvent>(32);

        let rebuild_params = Arc::new(CapturerRebuildParams {
            display_id: self.config.display.clone(),
            config: self.config.clone(),
            window_geometry: self.window_geometry(),
            system_audio: self.system_audio,
            excluded_windows: self.excluded_windows.clone(),
            video_info: self.video_info,
            video_tx: video_tx.clone(),
            audio_tx: audio_tx.clone(),
            error_tx: error_tx.clone(),
            video_frame_counter: video_frame_counter.clone(),
            drop_counter: drop_counter.clone(),
            system_audio_frame_counter: system_audio_frame_counter.clone(),
            system_audio_drop_counter: system_audio_drop_counter.clone(),
            frame_scaler: frame_scaler.clone(),
            scaling_logged: scaling_logged.clone(),
            scaled_frame_count: scaled_frame_count.clone(),
            stall_health_tx: stall_health_tx.clone(),
        });

        let builder = scap_screencapturekit::Capturer::builder(content_filter, settings)
            .with_output_sample_buf_cb({
                let video_frame_count = video_frame_counter.clone();
                let drop_counter = drop_counter.clone();
                let sys_audio_drop_counter = system_audio_drop_counter.clone();
                let sys_audio_frame_counter = system_audio_frame_counter.clone();
                let stall_health_tx = stall_health_tx.clone();
                let window_geometry = self.window_geometry();
                move |frame| {
                    let sample_buffer = frame.sample_buf();

                    let mach_timestamp =
                        cm::Clock::convert_host_time_to_sys_units(sample_buffer.pts());
                    let timestamp = Timestamp::MachAbsoluteTime(
                        cap_timestamp::MachAbsoluteTimestamp::new(mach_timestamp),
                    );

                    match &frame {
                        scap_screencapturekit::Frame::Screen(frame) => {
                            if let Some(state) = &window_geometry {
                                update_window_geometry(sample_buffer, state);
                            }
                            let Some(image_buf) = frame.image_buf() else {
                                return;
                            };
                            if image_buf.height() == 0 || image_buf.width() == 0 {
                                return;
                            }

                            let frame_width = image_buf.width();
                            let frame_height = image_buf.height();

                            let final_sample_buf =
                                if frame_width != expected_width || frame_height != expected_height
                                {
                                    let Ok(mut scaler_guard) = frame_scaler.lock() else {
                                        drop_counter.fetch_add(1, atomic::Ordering::Relaxed);
                                        return;
                                    };

                                    if scaler_guard.is_none() {
                                        *scaler_guard =
                                            FrameScaler::new(expected_width, expected_height);

                                        if scaler_guard.is_some() {
                                            info!(
                                                expected_width,
                                                expected_height,
                                                frame_width,
                                                frame_height,
                                                "Display configuration changed, scaling frames to match original dimensions"
                                            );
                                        } else {
                                            warn!(
                                                "Failed to create frame scaler, dropping mismatched frames"
                                            );
                                        }
                                        scaling_logged.store(true, atomic::Ordering::Relaxed);
                                    }

                                    let Some(scaler) = scaler_guard.as_ref() else {
                                        drop_counter.fetch_add(1, atomic::Ordering::Relaxed);
                                        return;
                                    };

                                    let Some(scaled) = scaler.scale_frame(sample_buffer) else {
                                        drop_counter.fetch_add(1, atomic::Ordering::Relaxed);
                                        return;
                                    };

                                    let count =
                                        scaled_frame_count.fetch_add(1, atomic::Ordering::Relaxed)
                                            + 1;
                                    if count.is_multiple_of(300) {
                                        debug!(scaled_frames = count, "Scaling frames");
                                    }

                                    scaled
                                } else {
                                    if scaling_logged.swap(false, atomic::Ordering::Relaxed) {
                                        let count =
                                            scaled_frame_count.swap(0, atomic::Ordering::Relaxed);
                                        info!(
                                            scaled_frames = count,
                                            "Display dimensions restored, resuming direct capture"
                                        );
                                        if let Ok(mut guard) = frame_scaler.lock() {
                                            *guard = None;
                                        }
                                    }

                                    sample_buffer.retained()
                                };

                            cap_fail::fail_ret!("screen_capture video frame skip");

                            video_frame_count.fetch_add(1, atomic::Ordering::Relaxed);

                            match output_pipeline::send_with_stall_budget_flume(
                                &video_tx,
                                VideoFrame {
                                    sample_buf: final_sample_buf,
                                    timestamp,
                                },
                                "screen-video",
                                &stall_health_tx,
                            ) {
                                output_pipeline::StallSendOutcome::Sent => {}
                                output_pipeline::StallSendOutcome::StalledAndDropped { .. }
                                | output_pipeline::StallSendOutcome::Disconnected => {
                                    drop_counter.fetch_add(1, atomic::Ordering::Relaxed);
                                }
                            }
                        }
                        scap_screencapturekit::Frame::Audio(_) => {
                            use ffmpeg::ChannelLayout;

                            cap_fail::fail_ret!("screen_capture audio frame skip");

                            let Some(audio_tx) = &mut audio_tx else {
                                return;
                            };

                            let Ok(buf_list) = sample_buffer.audio_buf_list::<2>() else {
                                warn!("Failed to extract audio buffer list from sample, dropping audio chunk");
                                return;
                            };
                            let Ok(slice) = buf_list.block().as_slice() else {
                                warn!("Failed to get audio buffer slice, dropping audio chunk");
                                return;
                            };

                            let mut frame = ffmpeg::frame::Audio::new(
                                ffmpeg::format::Sample::F32(ffmpeg::format::sample::Type::Planar),
                                sample_buffer.num_samples() as usize,
                                ChannelLayout::STEREO,
                            );
                            frame.set_rate(48_000);
                            let data_bytes_size =
                                buf_list.list().buffers[0].data_bytes_size as usize;
                            for i in 0..frame.planes() {
                                let start = i.saturating_mul(data_bytes_size);
                                let end = start.saturating_add(data_bytes_size);
                                let Some(source) = slice.get(start..end) else {
                                    warn!("Audio buffer slice too small for plane data, dropping audio chunk");
                                    return;
                                };
                                let destination = frame.data_mut(i);
                                if destination.len() != source.len() {
                                    warn!("Audio frame plane size mismatch, dropping audio chunk");
                                    return;
                                }
                                destination.copy_from_slice(source);
                            }

                            match output_pipeline::send_with_stall_budget_futures(
                                audio_tx,
                                AudioFrame::new(frame, timestamp),
                                "screen-system-audio",
                                &stall_health_tx,
                            ) {
                                output_pipeline::StallSendOutcome::Sent => {
                                    sys_audio_frame_counter
                                        .fetch_add(1, atomic::Ordering::Relaxed);
                                }
                                output_pipeline::StallSendOutcome::StalledAndDropped { .. }
                                | output_pipeline::StallSendOutcome::Disconnected => {
                                    sys_audio_drop_counter
                                        .fetch_add(1, atomic::Ordering::Relaxed);
                                }
                            }
                        }
                        _ => {}
                    }
                }
            })
            .with_stop_with_err_cb({
                let video_frame_count = video_frame_counter.clone();
                let error_tx = error_tx.clone();
                move |_, err| {
                    debug!(
                        "Capturer stopping after creating {} video frames",
                        video_frame_count.load(atomic::Ordering::Relaxed)
                    );

                    let _ = error_tx.send(err.retained());
                }
            });

        let cancel_token = CancellationToken::new();
        let capturer = Capturer::new(Arc::new(builder.build()?));

        Ok((
            VideoSourceConfig {
                inner: ChannelVideoSourceConfig::new(self.video_info, video_rx),
                capturer: capturer.clone(),
                error_rx: error_rx.resubscribe(),
                video_frame_counter: video_frame_counter.clone(),
                drop_counter,
                cancel_token: cancel_token.clone(),
                drop_guard: cancel_token.drop_guard(),
                rebuild_params: rebuild_params.clone(),
                stall_health_rx: Some(stall_health_rx),
            },
            audio_rx.map(|rx| {
                SystemAudioSourceConfig(
                    ChannelAudioSourceConfig::new(self.audio_info(), rx),
                    capturer,
                    error_rx,
                    system_audio_frame_counter,
                    system_audio_drop_counter,
                    rebuild_params,
                )
            }),
        ))
    }
}

// Public

pub struct StartCapturing;

// External

pub struct NewFrame(pub scap_screencapturekit::Frame);

// Internal

pub struct CaptureError(pub arc::R<ns::Error>);

struct Capturer {
    started: Arc<AtomicBool>,
    capturer: Arc<scap_screencapturekit::Capturer>,
}

impl Clone for Capturer {
    fn clone(&self) -> Self {
        Self {
            started: self.started.clone(),
            capturer: self.capturer.clone(),
            // error_rx: self.error_rx.resubscribe(),
        }
    }
}

impl Capturer {
    fn new(capturer: Arc<scap_screencapturekit::Capturer>) -> Self {
        Self {
            started: Arc::new(AtomicBool::new(false)),
            capturer,
        }
    }

    fn mark_stopped(&self) {
        self.started.store(false, atomic::Ordering::Relaxed);
    }

    async fn start(&self) -> anyhow::Result<()> {
        if self
            .started
            .compare_exchange(
                false,
                true,
                atomic::Ordering::Relaxed,
                atomic::Ordering::Relaxed,
            )
            .is_ok()
        {
            self.capturer
                .start()
                .await
                .map_err(|err| anyhow!(format!("{err}")))?;
        }

        Ok(())
    }

    async fn stop(&self) -> anyhow::Result<()> {
        if self
            .started
            .compare_exchange(
                true,
                false,
                atomic::Ordering::Relaxed,
                atomic::Ordering::Relaxed,
            )
            .is_ok()
        {
            self.capturer.stop().await.context("capturer_stop")?;
        }

        Ok(())
    }
}

pub struct VideoSourceConfig {
    inner: ChannelVideoSourceConfig<VideoFrame>,
    capturer: Capturer,
    error_rx: broadcast::Receiver<arc::R<ns::Error>>,
    cancel_token: CancellationToken,
    drop_guard: DropGuard,
    video_frame_counter: Arc<AtomicU32>,
    drop_counter: Arc<AtomicU64>,
    rebuild_params: Arc<CapturerRebuildParams>,
    stall_health_rx: Option<tokio::sync::mpsc::Receiver<output_pipeline::PipelineHealthEvent>>,
}
pub struct VideoSource {
    inner: ChannelVideoSource<VideoFrame>,
    capturer: Capturer,
    cancel_token: CancellationToken,
    video_frame_counter: Arc<AtomicU32>,
    drop_counter: Arc<AtomicU64>,
    _drop_guard: DropGuard,
    health_tx: output_pipeline::HealthSender,
    active_capturer: Arc<Mutex<Option<Capturer>>>,
}

impl output_pipeline::VideoSource for VideoSource {
    type Config = VideoSourceConfig;
    type Frame = VideoFrame;

    async fn setup(
        config: Self::Config,
        video_tx: mpsc::Sender<Self::Frame>,
        ctx: &mut SetupCtx,
    ) -> anyhow::Result<Self>
    where
        Self: Sized,
    {
        let VideoSourceConfig {
            inner,
            capturer,
            mut error_rx,
            cancel_token,
            drop_guard,
            video_frame_counter,
            drop_counter,
            rebuild_params,
            stall_health_rx,
        } = config;

        let monitor_cancel = cancel_token.clone();
        let pipeline_cancel = ctx.stop_token();
        let stop_signal = ctx.stop_signal();
        let health_tx = ctx.health_tx().clone();

        if let Some(mut stall_rx) = stall_health_rx {
            let forward_tx = ctx.health_tx().clone();
            let forward_cancel = cancel_token.clone();
            ctx.tasks()
                .spawn("screen-capture-stall-forwarder", async move {
                    loop {
                        tokio::select! {
                            _ = forward_cancel.cancelled() => break Ok(()),
                            event = stall_rx.recv() => match event {
                                Some(ev) => output_pipeline::emit_health(&forward_tx, ev),
                                None => break Ok(()),
                            }
                        }
                    }
                });
        }
        let active_capturer: Arc<Mutex<Option<Capturer>>> = Arc::new(Mutex::new(None));
        let active_capturer_for_stop = active_capturer.clone();
        let original_capturer = capturer.clone();
        ctx.tasks().spawn("screen-capture-monitor", async move {
            let mut restart_count = 0u32;

            loop {
                select! {
                    _ = monitor_cancel.cancelled() => break Ok(()),
                    recv = error_rx.recv() => {
                        let err = match recv {
                            Ok(err) => err,
                            Err(broadcast::error::RecvError::Closed) => break Ok(()),
                            Err(broadcast::error::RecvError::Lagged(_)) => {
                                warn!("Screen capture error channel lagged; continuing");
                                continue;
                            }
                        };

                        if is_user_stop_error(err.as_ref()) {
                            if let Ok(guard) = active_capturer.lock() {
                                match guard.as_ref() {
                                    Some(c) => c.mark_stopped(),
                                    None => original_capturer.mark_stopped(),
                                }
                            } else {
                                original_capturer.mark_stopped();
                            }

                            info!(
                                "Screen capture stream stopped from macOS sharing controls"
                            );
                            stop_signal.mark_user_stopped();
                            pipeline_cancel.cancel();
                            break Ok(());
                        }

                        if is_system_stop_error(err.as_ref()) {
                            if monitor_cancel.is_cancelled() {
                                break Ok(());
                            }

                            if let Ok(guard) = active_capturer.lock() {
                                match guard.as_ref() {
                                    Some(c) => c.mark_stopped(),
                                    None => original_capturer.mark_stopped(),
                                }
                            } else {
                                original_capturer.mark_stopped();
                            }

                            if restart_count >= MAX_CAPTURE_RESTARTS {
                                error!(
                                    restart_count,
                                    max_restarts = MAX_CAPTURE_RESTARTS,
                                    "Screen capture failed after max restart attempts"
                                );
                                return Err(anyhow!(system_stop_message()));
                            }

                            restart_count += 1;
                            warn!(
                                restart_count,
                                max_restarts = MAX_CAPTURE_RESTARTS,
                                "Screen capture stream stopped by system, attempting restart"
                            );

                            output_pipeline::emit_health(
                                &health_tx,
                                output_pipeline::PipelineHealthEvent::SourceRestarting,
                            );

                            tokio::time::sleep(RESTART_DELAY).await;

                            if monitor_cancel.is_cancelled() {
                                break Ok(());
                            }

                            if rebuild_params.config.window.is_none()
                                && Display::from_id(&rebuild_params.display_id).is_none()
                            {
                                error!(
                                    display_id = ?rebuild_params.display_id,
                                    "Capture target display is gone; aborting restart"
                                );
                                output_pipeline::emit_health(
                                    &health_tx,
                                    output_pipeline::PipelineHealthEvent::CaptureTargetLost {
                                        target: "display".to_string(),
                                    },
                                );
                                return Err(anyhow!(
                                    "Capture target display disappeared: {:?}",
                                    rebuild_params.display_id
                                ));
                            }

                            match rebuild_capturer(&rebuild_params).await {
                                Ok(new_capturer) => {
                                    if let Ok(mut guard) = active_capturer.lock() {
                                        *guard = Some(new_capturer);
                                    }
                                    info!(
                                        restart_count,
                                        "macOS screen capture restarted successfully"
                                    );
                                    output_pipeline::emit_health(
                                        &health_tx,
                                        output_pipeline::PipelineHealthEvent::SourceRestarted,
                                    );
                                    continue;
                                }
                                Err(e) => {
                                    error!(
                                        restart_count,
                                        error = %e,
                                        "Failed to restart macOS screen capture"
                                    );
                                    return Err(anyhow!(
                                        "Screen capture restart failed after {} attempts: {e}",
                                        restart_count
                                    ));
                                }
                            }
                        }

                        return Err(anyhow!(format!("{err}")));
                    }
                }
            }
        });

        let stats_health_tx = ctx.health_tx().clone();
        ChannelVideoSource::setup(inner, video_tx, ctx)
            .await
            .map(|source| Self {
                inner: source,
                capturer,
                cancel_token,
                _drop_guard: drop_guard,
                video_frame_counter,
                drop_counter,
                health_tx: stats_health_tx,
                active_capturer: active_capturer_for_stop,
            })
    }

    fn start(&mut self) -> BoxFuture<'_, anyhow::Result<()>> {
        async move {
            self.capturer.start().await?;

            tokio::spawn({
                let video_frame_count = self.video_frame_counter.clone();
                let drop_counter = self.drop_counter.clone();
                let health_tx = self.health_tx.clone();
                async move {
                    let mut prev_frames = 0u32;
                    let mut prev_drops = 0u64;
                    loop {
                        tokio::time::sleep(Duration::from_secs(5)).await;
                        let current_frames = video_frame_count.load(atomic::Ordering::Relaxed);
                        let current_drops = drop_counter.load(atomic::Ordering::Relaxed);

                        let frame_delta = current_frames.saturating_sub(prev_frames);
                        let drop_delta = current_drops.saturating_sub(prev_drops);

                        if frame_delta > 0 {
                            let drop_rate = 100.0 * drop_delta as f64
                                / (frame_delta as f64 + drop_delta as f64);
                            if drop_rate > 5.0 {
                                warn!(
                                    frames = frame_delta,
                                    drops = drop_delta,
                                    drop_rate_pct = format!("{:.1}%", drop_rate),
                                    total_frames = current_frames,
                                    total_drops = current_drops,
                                    "Screen capture frame drop rate exceeds 5% threshold"
                                );
                                output_pipeline::emit_health(
                                    &health_tx,
                                    output_pipeline::PipelineHealthEvent::FrameDropRateHigh {
                                        source: "screen-video".to_string(),
                                        rate_pct: drop_rate,
                                    },
                                );
                            } else {
                                debug!(
                                    frames = frame_delta,
                                    drops = drop_delta,
                                    drop_rate_pct = format!("{:.1}%", drop_rate),
                                    total_frames = current_frames,
                                    "Screen capture stats"
                                );
                            }
                        }

                        prev_frames = current_frames;
                        prev_drops = current_drops;
                    }
                }
                .with_cancellation_token_owned(self.cancel_token.clone())
                .in_current_span()
            });

            Ok(())
        }
        .boxed()
    }

    fn stop(&mut self) -> BoxFuture<'_, anyhow::Result<()>> {
        async move {
            debug!(
                "Capturer stopping after creating {} video frames",
                self.video_frame_counter.load(atomic::Ordering::Relaxed)
            );

            self.cancel_token.cancel();

            let capturer_to_stop = self
                .active_capturer
                .lock()
                .ok()
                .and_then(|mut guard| guard.take());

            let target = capturer_to_stop.as_ref().unwrap_or(&self.capturer);

            let stop_result =
                tokio::time::timeout(std::time::Duration::from_secs(5), target.stop()).await;

            match stop_result {
                Ok(result) => result,
                Err(_) => {
                    error!("Screen capturer stop timed out after 5s");
                    Err(anyhow::anyhow!(
                        "Screen capturer stop timed out after 5s — native resources may not be fully released"
                    ))
                }
            }
        }
        .boxed()
    }

    fn video_info(&self) -> VideoInfo {
        self.inner.video_info()
    }
}

fn is_system_stop_error(err: &ns::Error) -> bool {
    err.code() == sc::error::code::SYSTEM_STOPPED_STREAM as ns::Integer
        && err.domain().to_string() == sc::error::domain().to_string()
}

fn is_user_stop_error(err: &ns::Error) -> bool {
    err.code() == sc::error::code::USER_STOPPED as ns::Integer
        && err.domain().to_string() == sc::error::domain().to_string()
}

fn system_stop_message() -> &'static str {
    "Screen capture stopped because macOS made the display unavailable. This commonly happens when the lid is closed or the display sleeps."
}

struct CapturerRebuildParams {
    display_id: DisplayId,
    config: Config,
    window_geometry: Option<WindowGeometryState>,
    system_audio: bool,
    excluded_windows: Vec<WindowId>,
    video_info: VideoInfo,
    video_tx: flume::Sender<VideoFrame>,
    audio_tx: Option<mpsc::Sender<AudioFrame>>,
    error_tx: broadcast::Sender<arc::R<ns::Error>>,
    video_frame_counter: Arc<AtomicU32>,
    drop_counter: Arc<AtomicU64>,
    system_audio_frame_counter: Arc<AtomicU64>,
    system_audio_drop_counter: Arc<AtomicU64>,
    frame_scaler: Arc<Mutex<Option<FrameScaler>>>,
    scaling_logged: Arc<AtomicBool>,
    scaled_frame_count: Arc<AtomicU64>,
    stall_health_tx: output_pipeline::HealthSender,
}

unsafe impl Send for CapturerRebuildParams {}
unsafe impl Sync for CapturerRebuildParams {}

async fn rebuild_capturer(params: &CapturerRebuildParams) -> anyhow::Result<Capturer> {
    let shareable_content = sc::ShareableContent::current()
        .await
        .map_err(|e| anyhow!("Failed to get shareable content during restart: {e}"))?;

    let content_filter =
        params
            .config
            .content_filter(shareable_content, &params.excluded_windows, "restart")?;

    let size = PhysicalSize::new(
        params.video_info.width as f64,
        params.video_info.height as f64,
    );

    let max_queue_depth = get_max_queue_depth();
    let queue_depth =
        ((params.config.fps as f32 / 30.0 * 5.0).ceil() as isize).clamp(3, max_queue_depth);

    let mut settings = scap_screencapturekit::StreamCfgBuilder::default()
        .with_width(size.width() as usize)
        .with_height(size.height() as usize)
        .with_fps(params.config.fps as f32)
        .with_shows_cursor(params.config.show_cursor)
        .with_captures_audio(params.system_audio)
        .with_queue_depth(queue_depth)
        .build();

    settings.set_pixel_format(cv::PixelFormat::_420V);
    settings.set_color_space_name(cg::color_space::names::srgb());

    params.config.apply_capture_region(&mut settings);

    let expected_width = params.video_info.width as usize;
    let expected_height = params.video_info.height as usize;

    let video_tx = params.video_tx.clone();
    let mut audio_tx = params.audio_tx.clone();
    let error_tx = params.error_tx.clone();

    let builder = scap_screencapturekit::Capturer::builder(content_filter, settings)
        .with_output_sample_buf_cb({
            let window_geometry = params.window_geometry.clone();
            let video_frame_count = params.video_frame_counter.clone();
            let drop_counter = params.drop_counter.clone();
            let frame_scaler = params.frame_scaler.clone();
            let scaling_logged = params.scaling_logged.clone();
            let scaled_frame_count = params.scaled_frame_count.clone();
            let sys_audio_drop_counter = params.system_audio_drop_counter.clone();
            let sys_audio_frame_counter = params.system_audio_frame_counter.clone();
            let stall_health_tx = params.stall_health_tx.clone();
            move |frame| {
                let sample_buffer = frame.sample_buf();

                let mach_timestamp =
                    cm::Clock::convert_host_time_to_sys_units(sample_buffer.pts());
                let timestamp = Timestamp::MachAbsoluteTime(
                    cap_timestamp::MachAbsoluteTimestamp::new(mach_timestamp),
                );

                match &frame {
                    scap_screencapturekit::Frame::Screen(frame) => {
                        if let Some(state) = &window_geometry {
                            update_window_geometry(sample_buffer, state);
                        }
                        let Some(image_buf) = frame.image_buf() else {
                            return;
                        };
                        if image_buf.height() == 0 || image_buf.width() == 0 {
                            return;
                        }

                        let frame_width = image_buf.width();
                        let frame_height = image_buf.height();

                        let final_sample_buf =
                            if frame_width != expected_width || frame_height != expected_height {
                                let Ok(mut scaler_guard) = frame_scaler.lock() else {
                                    drop_counter.fetch_add(1, atomic::Ordering::Relaxed);
                                    return;
                                };

                                if scaler_guard.is_none() {
                                    *scaler_guard =
                                        FrameScaler::new(expected_width, expected_height);

                                    if scaler_guard.is_some() {
                                        info!(
                                            expected_width,
                                            expected_height,
                                            frame_width,
                                            frame_height,
                                            "Display configuration changed, scaling frames to match original dimensions"
                                        );
                                    } else {
                                        warn!(
                                            "Failed to create frame scaler, dropping mismatched frames"
                                        );
                                    }
                                    scaling_logged.store(true, atomic::Ordering::Relaxed);
                                }

                                let Some(scaler) = scaler_guard.as_ref() else {
                                    drop_counter.fetch_add(1, atomic::Ordering::Relaxed);
                                    return;
                                };

                                let Some(scaled) = scaler.scale_frame(sample_buffer) else {
                                    drop_counter.fetch_add(1, atomic::Ordering::Relaxed);
                                    return;
                                };

                                let count =
                                    scaled_frame_count.fetch_add(1, atomic::Ordering::Relaxed) + 1;
                                if count.is_multiple_of(300) {
                                    debug!(scaled_frames = count, "Scaling frames");
                                }

                                scaled
                            } else {
                                if scaling_logged.swap(false, atomic::Ordering::Relaxed) {
                                    let count =
                                        scaled_frame_count.swap(0, atomic::Ordering::Relaxed);
                                    info!(
                                        scaled_frames = count,
                                        "Display dimensions restored, resuming direct capture"
                                    );
                                    if let Ok(mut guard) = frame_scaler.lock() {
                                        *guard = None;
                                    }
                                }

                                    sample_buffer.retained()
                            };

                        cap_fail::fail_ret!("screen_capture video frame skip");

                        video_frame_count.fetch_add(1, atomic::Ordering::Relaxed);

                        match output_pipeline::send_with_stall_budget_flume(
                            &video_tx,
                            VideoFrame {
                                sample_buf: final_sample_buf,
                                timestamp,
                            },
                            "screen-video",
                            &stall_health_tx,
                        ) {
                            output_pipeline::StallSendOutcome::Sent => {}
                            output_pipeline::StallSendOutcome::StalledAndDropped { .. }
                            | output_pipeline::StallSendOutcome::Disconnected => {
                                drop_counter.fetch_add(1, atomic::Ordering::Relaxed);
                            }
                        }
                    }
                    scap_screencapturekit::Frame::Audio(_) => {
                        use ffmpeg::ChannelLayout;

                        cap_fail::fail_ret!("screen_capture audio frame skip");

                        let Some(audio_tx) = &mut audio_tx else {
                            return;
                        };

                        let Ok(buf_list) = sample_buffer.audio_buf_list::<2>() else {
                            warn!("Failed to extract audio buffer list from sample, dropping audio chunk");
                            return;
                        };
                        let Ok(slice) = buf_list.block().as_slice() else {
                            warn!("Failed to get audio buffer slice, dropping audio chunk");
                            return;
                        };

                        let mut frame = ffmpeg::frame::Audio::new(
                            ffmpeg::format::Sample::F32(ffmpeg::format::sample::Type::Planar),
                            sample_buffer.num_samples() as usize,
                            ChannelLayout::STEREO,
                        );
                        frame.set_rate(48_000);
                        let data_bytes_size = buf_list.list().buffers[0].data_bytes_size;
                        for i in 0..frame.planes() {
                            frame.data_mut(i).copy_from_slice(
                                &slice[i * data_bytes_size as usize
                                    ..(i + 1) * data_bytes_size as usize],
                            );
                        }

                        match output_pipeline::send_with_stall_budget_futures(
                            audio_tx,
                            AudioFrame::new(frame, timestamp),
                            "screen-system-audio",
                            &stall_health_tx,
                        ) {
                            output_pipeline::StallSendOutcome::Sent => {
                                sys_audio_frame_counter
                                    .fetch_add(1, atomic::Ordering::Relaxed);
                            }
                            output_pipeline::StallSendOutcome::StalledAndDropped { .. }
                            | output_pipeline::StallSendOutcome::Disconnected => {
                                sys_audio_drop_counter
                                    .fetch_add(1, atomic::Ordering::Relaxed);
                            }
                        }
                    }
                    _ => {}
                }
            }
        })
        .with_stop_with_err_cb({
            let video_frame_count = params.video_frame_counter.clone();
            move |_, err| {
                debug!(
                    "Capturer stopping after creating {} video frames",
                    video_frame_count.load(atomic::Ordering::Relaxed)
                );
                let _ = error_tx.send(err.retained());
            }
        });

    let capturer = Capturer::new(Arc::new(builder.build()?));
    capturer.start().await?;
    Ok(capturer)
}

pub struct SystemAudioSourceConfig(
    ChannelAudioSourceConfig,
    Capturer,
    broadcast::Receiver<arc::R<ns::Error>>,
    Arc<AtomicU64>,
    Arc<AtomicU64>,
    Arc<CapturerRebuildParams>,
);

pub struct SystemAudioSource {
    inner: ChannelAudioSource,
    capturer: Capturer,
    cancel_token: CancellationToken,
}

impl output_pipeline::AudioSource for SystemAudioSource {
    type Config = SystemAudioSourceConfig;

    fn setup(
        config: Self::Config,
        tx: mpsc::Sender<AudioFrame>,
        ctx: &mut SetupCtx,
    ) -> impl Future<Output = anyhow::Result<Self>> + 'static
    where
        Self: Sized,
    {
        let SystemAudioSourceConfig(
            channel_config,
            capturer,
            mut error_rx,
            frame_counter,
            drop_counter,
            _rebuild_params,
        ) = config;

        let cancel_token = CancellationToken::new();
        let pipeline_cancel = ctx.stop_token();
        let stop_signal = ctx.stop_signal();
        let capturer_for_monitor = capturer.clone();

        ctx.tasks().spawn("system-audio", {
            let cancel = cancel_token.child_token();
            async move {
                let mut system_stop_count = 0u32;

                loop {
                    tokio::select! {
                        biased;
                        _ = cancel.cancelled() => break,
                        result = error_rx.recv() => {
                            match result {
                                Ok(err) => {
                                    if is_user_stop_error(err.as_ref()) {
                                        capturer_for_monitor.mark_stopped();
                                        info!(
                                            "Screen capture audio stream stopped from macOS sharing controls"
                                        );
                                        stop_signal.mark_user_stopped();
                                        pipeline_cancel.cancel();
                                        break;
                                    }
                                    if is_system_stop_error(err.as_ref()) {
                                        system_stop_count += 1;
                                        if system_stop_count > MAX_CAPTURE_RESTARTS {
                                            warn!("Screen capture audio stream stopped by the system (exhausted restarts)");
                                            return Err(anyhow!(system_stop_message()));
                                        }
                                        warn!(
                                            system_stop_count,
                                            "Screen capture audio stream stopped by system, waiting for restart"
                                        );
                                        tokio::time::sleep(RESTART_DELAY + Duration::from_secs(1)).await;
                                        continue;
                                    }
                                    return Err(anyhow!("{err}"));
                                }
                                Err(broadcast::error::RecvError::Closed) => break,
                                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                            }
                        }
                    }
                }

                Ok(())
            }
        });

        let stats_cancel = cancel_token.clone();
        tokio::spawn(
            async move {
                let mut last_log = Instant::now();
                loop {
                    tokio::time::sleep(Duration::from_secs(5)).await;
                    let captured = frame_counter.load(atomic::Ordering::Relaxed);
                    let dropped = drop_counter.load(atomic::Ordering::Relaxed);

                    if dropped > 0 {
                        let total = captured + dropped;
                        let drop_pct = if total > 0 {
                            100.0 * dropped as f64 / total as f64
                        } else {
                            0.0
                        };

                        if last_log.elapsed() >= Duration::from_secs(5) {
                            warn!(
                                captured = captured,
                                dropped = dropped,
                                drop_pct = format!("{:.1}%", drop_pct),
                                "System audio dropping frames due to full channel"
                            );
                            last_log = Instant::now();
                        }
                    } else if captured > 0 {
                        debug!(captured = captured, "System audio frames captured");
                    }
                }
            }
            .with_cancellation_token_owned(stats_cancel)
            .in_current_span(),
        );

        ChannelAudioSource::setup(channel_config, tx, ctx).map({
            let cancel_token = cancel_token.clone();
            move |v| {
                v.map(|source| Self {
                    inner: source,
                    capturer,
                    cancel_token,
                })
            }
        })
    }

    async fn start(&mut self) -> anyhow::Result<()> {
        self.capturer.start().await?;

        Ok(())
    }

    async fn stop(&mut self) -> anyhow::Result<()> {
        self.cancel_token.cancel();
        self.capturer.stop().await?;

        Ok(())
    }

    fn audio_info(&self) -> AudioInfo {
        self.inner.audio_info()
    }
}
