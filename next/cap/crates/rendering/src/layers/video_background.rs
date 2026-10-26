use std::{
    path::{Path, PathBuf},
    sync::{Arc, mpsc},
};
use tokio::sync::oneshot;

#[derive(Clone)]
pub(crate) struct VideoPixels {
    pub data: Arc<Vec<u8>>,
    pub width: u32,
    pub height: u32,
}
pub(crate) enum VideoFrame {
    Rgba(VideoPixels),
    #[cfg(target_os = "macos")]
    Native(crate::DecodedFrame),
}
impl VideoFrame {
    pub fn size(&self) -> (u32, u32) {
        match self {
            Self::Rgba(pixels) => (pixels.width, pixels.height),
            #[cfg(target_os = "macos")]
            Self::Native(frame) => (frame.width(), frame.height()),
        }
    }
}
type Reply = oneshot::Sender<Result<VideoPixels, String>>;
enum Request {
    Accurate(f64, oneshot::Sender<Result<VideoFrame, String>>),
    #[cfg(target_os = "macos")]
    Native(crate::DecodedFrame, Reply),
}
pub(crate) struct VideoBackground {
    pub path: String,
    sender: mpsc::Sender<Request>,
    #[cfg(target_os = "macos")]
    native: Option<super::live_video_background::LiveVideoBackground>,
    #[cfg(target_os = "macos")]
    native_frame: Option<crate::DecodedFrame>,
    #[cfg(target_os = "macos")]
    native_compatible: bool,
}

pub(crate) fn is_video(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|v| v.to_str())
        .is_some_and(|v| matches!(v.to_ascii_lowercase().as_str(), "mov" | "mp4" | "m4v"))
}

pub(crate) fn loop_time(time: f64, duration: f64) -> f64 {
    if time.is_finite() && duration.is_finite() && duration > 0.0 {
        time.max(0.0).rem_euclid(duration)
    } else {
        0.0
    }
}

#[cfg(target_os = "macos")]
fn native_video_compatible(path: &str) -> bool {
    let Ok(input) = ffmpeg::format::input(path) else {
        return false;
    };
    let Some(stream) = input.streams().best(ffmpeg::media::Type::Video) else {
        return false;
    };
    let Ok(context) = ffmpeg::codec::Context::from_parameters(stream.parameters()) else {
        return false;
    };
    context.decoder().video().is_ok_and(|decoder| {
        // A 10-bit SDR aerial is still SDR; classify HDR by its transfer function.
        let compatible = !matches!(decoder.color_transfer_characteristic(),
            ffmpeg::color::TransferCharacteristic::SMPTE2084 | ffmpeg::color::TransferCharacteristic::ARIB_STD_B67)
            && decoder.format().descriptor().is_some_and(|format| format.nb_components() <= 3 && format.log2_chroma_w() == 1 && format.log2_chroma_h() == 1);
        tracing::debug!(format = ?decoder.format(), transfer = ?decoder.color_transfer_characteristic(), compatible, "Wallpaper live backend selection");
        compatible
    })
}

impl VideoBackground {
    pub fn new(path: String, realtime: bool) -> Result<Self, String> {
        let (sender, receiver) = mpsc::channel::<Request>();
        let worker_path = PathBuf::from(&path);
        #[cfg(target_os = "macos")]
        let compatible = native_video_compatible(&path);
        #[cfg(target_os = "macos")]
        let handle = tokio::runtime::Handle::current();
        std::thread::Builder::new()
            .name("wallpaper-video".into())
            .spawn(move || {
                let mut reader = None;
                #[cfg(target_os = "macos")]
                let mut scaler = None;
                #[cfg(target_os = "macos")]
                let mut native_reader = None;
                #[cfg(target_os = "macos")]
                let mut prefer_native = compatible;
                for request in receiver {
                    match request {
                        Request::Accurate(time, reply) => {
                            if reply.is_closed() {
                                continue;
                            }
                            #[cfg(target_os = "macos")]
                            if prefer_native {
                                let result = objc2::rc::autoreleasepool(|_| {
                                    if native_reader.is_none() {
                                        native_reader = Some(super::precise_video_background::PreciseVideoBackground::open_with_cancel(&worker_path, handle.clone(), || reply.is_closed())?);
                                    }
                                    native_reader.as_mut().ok_or("精确壁纸解码器未就绪")?.frame_with_cancel(time, || reply.is_closed())
                                });
                                if reply.is_closed() {
                                    continue;
                                }
                                match result {
                                    Ok(frame) => {
                                        let _ = reply.send(Ok(VideoFrame::Native(frame)));
                                        objc2::rc::autoreleasepool(|_| {
                                            if let Some(reader) = &mut native_reader {
                                                reader.prefetch();
                                            }
                                        });
                                        continue;
                                    }
                                    Err(error) => {
                                        tracing::warn!(%error, "Precise native wallpaper unavailable; using FFmpeg");
                                        native_reader = None;
                                        prefer_native = false;
                                    }
                                }
                            }
                            let reader = reader.get_or_insert_with(|| Reader::open(&worker_path));
                            let result = match reader {
                                Ok(reader) => reader.frame(time),
                                Err(error) => Err(error.clone()),
                            };
                            let _ = reply.send(result.map(VideoFrame::Rgba));
                        }
                        #[cfg(target_os = "macos")]
                        Request::Native(frame, reply) => {
                            if !reply.is_closed() {
                                let _ = reply.send(native_pixels(&frame, &mut scaler));
                            }
                        }
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        #[cfg(not(target_os = "macos"))]
        let _ = realtime;
        Ok(Self {
            #[cfg(target_os = "macos")]
            native: (realtime && compatible)
                .then(|| super::live_video_background::LiveVideoBackground::new(path.clone())),
            #[cfg(target_os = "macos")]
            native_frame: None,
            #[cfg(target_os = "macos")]
            native_compatible: compatible,
            path,
            sender,
        })
    }

    pub fn set_realtime(&mut self, realtime: bool) {
        #[cfg(target_os = "macos")]
        if realtime {
            if self.native_compatible && self.native.is_none() {
                self.native = Some(super::live_video_background::LiveVideoBackground::new(
                    self.path.clone(),
                ));
            }
        } else {
            self.pause();
        }
        #[cfg(not(target_os = "macos"))]
        let _ = realtime;
    }

    #[cfg(target_os = "macos")]
    fn pause(&mut self) {
        if let Some(native) = &self.native {
            native.pause();
        }
        self.native_frame = None;
    }

    pub async fn source(&mut self, time: f64, playing: bool) -> Result<VideoFrame, String> {
        #[cfg(target_os = "macos")]
        if !playing {
            self.pause();
        }
        #[cfg(target_os = "macos")]
        if playing && let Some(native) = &self.native {
            let started = std::time::Instant::now();
            loop {
                match native.frame(time, playing).await {
                    Ok(Some(frame)) => {
                        self.native_frame = Some(frame.clone());
                        return Ok(VideoFrame::Native(frame));
                    }
                    Ok(None) => {
                        if let Some(frame) = &self.native_frame {
                            return Ok(VideoFrame::Native(frame.clone()));
                        }
                        if started.elapsed() > std::time::Duration::from_secs(5) {
                            tracing::warn!(
                                "Native wallpaper playback timed out; using precise decoder"
                            );
                            break;
                        }
                        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
                    }
                    Err(error) => {
                        tracing::warn!(%error, "Native wallpaper playback unavailable; using precise decoder");
                        break;
                    }
                }
            }
            self.native = None;
        }
        #[cfg(not(target_os = "macos"))]
        let _ = playing;
        let (reply, receive) = oneshot::channel();
        self.sender
            .send(Request::Accurate(time, reply))
            .map_err(|e| e.to_string())?;
        let frame = tokio::time::timeout(std::time::Duration::from_secs(15), receive)
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())??;
        Ok(frame)
    }

    pub async fn materialize(&self, frame: VideoFrame) -> Result<VideoPixels, String> {
        match frame {
            VideoFrame::Rgba(pixels) => Ok(pixels),
            #[cfg(target_os = "macos")]
            VideoFrame::Native(frame) => {
                let (reply, receive) = oneshot::channel();
                self.sender
                    .send(Request::Native(frame, reply))
                    .map_err(|error| error.to_string())?;
                receive.await.map_err(|error| error.to_string())?
            }
        }
    }

    #[cfg(test)]
    pub async fn frame(&mut self, time: f64, playing: bool) -> Result<VideoPixels, String> {
        let frame = self.source(time, playing).await?;
        self.materialize(frame).await
    }
}

struct Reader {
    decoder: cap_video_decode::FFmpegDecoder,
    scaler: Option<ffmpeg::software::scaling::Context>,
    duration: f64,
    time_base: f64,
    last_time: f64,
    last_request: f64,
    last_frame: Option<ffmpeg::frame::Video>,
    last_pixels: Option<(f64, VideoPixels)>,
}
impl Reader {
    fn open(path: &Path) -> Result<Self, String> {
        let input = ffmpeg::format::input(path).map_err(|e| e.to_string())?;
        let stream = input
            .streams()
            .best(ffmpeg::media::Type::Video)
            .ok_or("壁纸没有视频轨道")?;
        let time_base = f64::from(stream.time_base());
        let duration = if stream.duration() > 0 {
            stream.duration() as f64 * time_base
        } else {
            input.duration() as f64 / 1_000_000.0
        };
        #[cfg(target_os = "macos")]
        let hw = Some(ffmpeg::sys::AVHWDeviceType::AV_HWDEVICE_TYPE_VIDEOTOOLBOX);
        #[cfg(not(target_os = "macos"))]
        let hw = None;
        let decoder = cap_video_decode::FFmpegDecoder::new(path, hw)
            .or_else(|_| cap_video_decode::FFmpegDecoder::new(path, None))?;
        Ok(Self {
            decoder,
            scaler: None,
            duration,
            time_base,
            last_time: -1.0,
            last_request: -1.0,
            last_frame: None,
            last_pixels: None,
        })
    }
    fn frame(&mut self, time: f64) -> Result<VideoPixels, String> {
        let time = loop_time(time, self.duration);
        if (self.last_request >= 0.0 && time < self.last_request - 0.0001)
            || time > self.last_time + 2.0
        {
            self.decoder.reset(time as f32).map_err(|e| e.to_string())?;
            self.last_frame = None;
            self.last_pixels = None;
            self.last_time = -1.0;
        }
        self.last_request = time;
        while self.last_frame.is_none() || self.last_time + 0.0001 < time {
            let Some(frame) = self.decoder.native_frames().next() else {
                break;
            };
            let frame = frame.map_err(|e| e.to_string())?;
            self.last_time = frame
                .timestamp()
                .or(frame.pts())
                .map_or(time, |pts| pts as f64 * self.time_base);
            self.last_frame = Some(frame);
        }
        if let Some((time, pixels)) = &self.last_pixels
            && *time == self.last_time
        {
            return Ok(pixels.clone());
        }
        let source = self
            .decoder
            .download_frame(self.last_frame.as_ref().ok_or("无法解码壁纸帧")?);
        let pixels = convert_pixels(&source, &mut self.scaler)?;
        self.last_pixels = Some((self.last_time, pixels.clone()));
        Ok(pixels)
    }
}
fn convert_pixels(
    source: &ffmpeg::frame::Video,
    scaler: &mut Option<ffmpeg::software::scaling::Context>,
) -> Result<VideoPixels, String> {
    let scale = (2560.0 / f64::from(source.width().max(source.height()))).min(1.0);
    let width = (f64::from(source.width()) * scale).round().max(1.0) as u32;
    let height = (f64::from(source.height()) * scale).round().max(1.0) as u32;
    if scaler.is_none() {
        *scaler = Some(
            ffmpeg::software::scaling::Context::get(
                source.format(),
                source.width(),
                source.height(),
                ffmpeg::format::Pixel::RGBA,
                width,
                height,
                ffmpeg::software::scaling::Flags::BILINEAR,
            )
            .map_err(|e| e.to_string())?,
        );
    }
    let mut rgba = ffmpeg::frame::Video::new(ffmpeg::format::Pixel::RGBA, width, height);
    scaler
        .as_mut()
        .ok_or("无法转换壁纸帧")?
        .run(source, &mut rgba)
        .map_err(|e| e.to_string())?;
    let mut data = Vec::with_capacity(width as usize * height as usize * 4);
    for row in rgba.data(0).chunks(rgba.stride(0)).take(height as usize) {
        data.extend_from_slice(&row[..width as usize * 4]);
    }
    Ok(VideoPixels {
        data: Arc::new(data),
        width,
        height,
    })
}

#[cfg(target_os = "macos")]
fn native_pixels(
    frame: &crate::DecodedFrame,
    scaler: &mut Option<ffmpeg::software::scaling::Context>,
) -> Result<VideoPixels, String> {
    use cidre::cv::pixel_buffer::LockFlags;
    frame
        .with_image_buf(|image| unsafe {
            let mut image = image.retained();
            image
                .lock_base_addr(LockFlags::READ_ONLY)
                .result()
                .map_err(|error| format!("{error:?}"))?;
            let mut source = ffmpeg::frame::Video::empty();
            source.set_format(ffmpeg::format::Pixel::NV12);
            source.set_width(frame.width());
            source.set_height(frame.height());
            // These planes remain borrowed and locked until swscale finishes; AVFrame owns no pixel buffer.
            for plane in 0..2 {
                (*source.as_mut_ptr()).data[plane] = image.plane_base_address(plane).cast_mut();
                (*source.as_mut_ptr()).linesize[plane] = image.plane_bytes_per_row(plane) as i32;
            }
            let result = convert_pixels(&source, scaler);
            image.unlock_lock_base_addr(LockFlags::READ_ONLY);
            result
        })
        .ok_or("壁纸像素缓冲区已释放".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn paused_realtime_wallpaper_keeps_native_precision_across_mode_changes() {
        let Some(path) = std::env::var_os("JIANKU_TEST_WALLPAPER_VIDEO") else {
            return;
        };
        let mut video = VideoBackground::new(path.to_string_lossy().into_owned(), true).unwrap();
        let mut reference = Reader::open(Path::new(&path)).unwrap();
        for (time, realtime) in [(0.7, true), (0.0, false), (0.3, true), (0.3, false)] {
            video.set_realtime(realtime);
            let VideoFrame::Native(frame) = video.source(time, false).await.unwrap() else {
                panic!("Paused wallpaper should retain the precise native path");
            };
            let actual = native_pixels(&frame, &mut None).unwrap();
            let expected = reference.frame(time).unwrap();
            let mean = actual
                .data
                .iter()
                .zip(expected.data.iter())
                .map(|(a, b)| f64::from(a.abs_diff(*b)))
                .sum::<f64>()
                / actual.data.len() as f64;
            assert!(mean < 3.0, "Paused wallpaper pixel difference={mean}");
        }
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn native_precise_sampling_matches_seek_loop_and_prefetch_reference() {
        let Some(path) = std::env::var_os("JIANKU_TEST_WALLPAPER_VIDEO") else {
            return;
        };
        let handle = tokio::runtime::Handle::current();
        tokio::task::spawn_blocking(move || {
            objc2::rc::autoreleasepool(|_| {
                let mut native =
                    super::super::precise_video_background::PreciseVideoBackground::open(
                        Path::new(&path),
                        handle,
                    )
                    .unwrap();
                let mut reference = Reader::open(Path::new(&path)).unwrap();
                for time in [
                    0.0,
                    1.0 / 60.0,
                    2.0 / 60.0,
                    3.0 / 60.0,
                    0.3,
                    1.18,
                    1.2,
                    1.2 + 1.0 / 60.0,
                    0.017,
                    0.3,
                    0.0,
                    0.0,
                ] {
                    let frame = native.frame(time).unwrap();
                    let actual = native_pixels(&frame, &mut None).unwrap();
                    let expected = reference.frame(time).unwrap();
                    assert_eq!(
                        (actual.width, actual.height),
                        (expected.width, expected.height)
                    );
                    let differences: Vec<_> = actual
                        .data
                        .iter()
                        .zip(expected.data.iter())
                        .map(|(a, b)| a.abs_diff(*b))
                        .collect();
                    let mean = differences.iter().map(|d| f64::from(*d)).sum::<f64>()
                        / differences.len() as f64;
                    println!(
                        "time={time} native_pts={} reference_pts={} mean pixel difference={mean}",
                        native.decoded_time(),
                        reference.last_time
                    );
                    assert!((native.decoded_time() - reference.last_time).abs() < 0.0001);
                    assert!(mean < 3.0, "time={time}, mean pixel difference={mean}");
                    native.prefetch();
                }
            })
        })
        .await
        .unwrap();
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn reopened_precise_wallpaper_preserves_pixels_seeks_and_looping() {
        let Some(path) = std::env::var_os("JIANKU_TEST_INDEX_CACHE_VIDEO") else {
            return;
        };
        let handle = tokio::runtime::Handle::current();
        tokio::task::spawn_blocking(move || {
            objc2::rc::autoreleasepool(|_| {
                let mut first =
                    super::super::precise_video_background::PreciseVideoBackground::open(
                        Path::new(&path),
                        handle.clone(),
                    )
                    .unwrap();
                let mut reopened =
                    super::super::precise_video_background::PreciseVideoBackground::open(
                        Path::new(&path),
                        handle,
                    )
                    .unwrap();
                let reference = Reader::open(Path::new(&path)).unwrap();
                let duration = reference.duration;
                for time in [
                    0.0,
                    1.0 / 60.0,
                    2.0 / 60.0,
                    1.18,
                    1.2,
                    0.017,
                    duration / 2.0,
                    0.0,
                    duration + 0.3,
                ] {
                    let expected = native_pixels(&first.frame(time).unwrap(), &mut None).unwrap();
                    let actual = native_pixels(&reopened.frame(time).unwrap(), &mut None).unwrap();
                    assert_eq!(first.decoded_time(), reopened.decoded_time());
                    assert_eq!(expected.data, actual.data);
                    assert_eq!(
                        (expected.width, expected.height),
                        (actual.width, actual.height)
                    );
                    first.prefetch();
                    reopened.prefetch();
                }
                println!("reopened precise wallpaper: 9 timestamps and pixel buffers identical");
            });
        })
        .await
        .unwrap();
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn high_rate_precise_source_returns_native_surface() {
        let Some(path) = std::env::var_os("JIANKU_TEST_HIGH_RATE_WALLPAPER") else {
            return;
        };
        let mut reader = VideoBackground::new(path.to_string_lossy().into_owned(), false).unwrap();
        let start = std::time::Instant::now();
        for number in 0..=30 {
            let VideoFrame::Native(frame) = reader
                .source(0.7 + f64::from(number) / 60.0, false)
                .await
                .unwrap()
            else {
                panic!("Precise path fell back to CPU")
            };
            assert_eq!((frame.width(), frame.height()), (3840, 2160));
            assert_eq!(
                frame.with_image_buf(|image| image.io_surf().is_some()),
                Some(true)
            );
        }
        println!("31 precise native wallpaper frames: {:?}", start.elapsed());
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn first_wallpaper_request_after_pause_preserves_exact_pixels_and_rewind() {
        let Some(path) = std::env::var_os("JIANKU_TEST_HIGH_RATE_WALLPAPER") else {
            return;
        };
        let handle = tokio::runtime::Handle::current();
        tokio::task::spawn_blocking(move || {
            objc2::rc::autoreleasepool(|_| {
                let mut native =
                    super::super::precise_video_background::PreciseVideoBackground::open(
                        Path::new(&path),
                        handle,
                    )
                    .unwrap();
                let started = std::time::Instant::now();
                let late = native.frame(30.1).unwrap();
                let elapsed = started.elapsed();
                assert!((native.decoded_time() - 30.1).abs() < 0.01);
                let mut reference = Reader::open(Path::new(&path)).unwrap();
                let expected = reference.frame(30.1).unwrap();
                let actual = native_pixels(&late, &mut None).unwrap();
                let mean = actual
                    .data
                    .iter()
                    .zip(expected.data.iter())
                    .map(|(a, b)| f64::from(a.abs_diff(*b)))
                    .sum::<f64>()
                    / actual.data.len() as f64;
                assert!((native.decoded_time() - reference.last_time).abs() < 0.0001);
                assert!(mean < 3.0, "late seek pixel difference={mean}");
                let rewound = native.frame(0.0).unwrap();
                assert!(native.decoded_time() < 0.01);
                assert_eq!(
                    (rewound.width(), rewound.height()),
                    (late.width(), late.height())
                );
                println!("late initial seek={elapsed:?}, mean pixel difference={mean}");
            })
        })
        .await
        .unwrap();
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn discarded_wallpaper_seek_can_rewind_without_publishing_the_old_frame() {
        let Some(path) = std::env::var_os("JIANKU_TEST_HIGH_RATE_WALLPAPER") else {
            return;
        };
        let handle = tokio::runtime::Handle::current();
        tokio::task::spawn_blocking(move || {
            objc2::rc::autoreleasepool(|_| {
                let mut native =
                    super::super::precise_video_background::PreciseVideoBackground::open(
                        Path::new(&path),
                        handle,
                    )
                    .unwrap();
                let started = std::time::Instant::now();
                let result = native.frame_with_cancel(30.0, || {
                    started.elapsed() > std::time::Duration::from_millis(100)
                });
                assert!(result.is_err());
                let rewound = native.frame(0.0).unwrap();
                assert!(native.decoded_time() < 0.01);
                assert!(rewound.width() > 0);
            });
        })
        .await
        .unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn native_pixel_planes_preserve_the_precise_color_conversion() {
        use cidre::cv::{self, pixel_buffer::LockFlags};
        let mut image = cv::ImageBuf::new(16, 8, cv::PixelFormat::_420V, None).unwrap();
        let mut reference = ffmpeg::frame::Video::new(ffmpeg::format::Pixel::NV12, 16, 8);
        unsafe {
            image.lock_base_addr(LockFlags::DEFAULT).result().unwrap();
            for plane in 0..2 {
                let height = if plane == 0 { 8 } else { 4 };
                let target_stride = reference.stride(plane);
                let native_stride = image.plane_bytes_per_row(plane);
                let native = std::slice::from_raw_parts_mut(
                    image.plane_base_address(plane).cast_mut(),
                    native_stride * height,
                );
                for row in 0..height {
                    for column in 0..16 {
                        let value = if plane == 0 {
                            32 + row * 16 + column
                        } else {
                            96 + column * 3
                        } as u8;
                        native[row * native_stride + column] = value;
                        reference.data_mut(plane)[row * target_stride + column] = value;
                    }
                }
            }
            image.unlock_lock_base_addr(LockFlags::DEFAULT);
        }
        let decoded = crate::DecodedFrame::new_nv12_with_image_buf(
            16,
            8,
            image.plane_bytes_per_row(0) as u32,
            image.plane_bytes_per_row(1) as u32,
            image,
        );
        let expected = convert_pixels(&reference, &mut None).unwrap();
        let actual = native_pixels(&decoded, &mut None).unwrap();
        assert_eq!(actual.data, expected.data);
        assert_eq!((actual.width, actual.height), (16, 8));
    }
    #[test]
    fn samples_high_rate_wallpaper_and_repeats_exact_pixels() {
        let Some(path) = std::env::var_os("JIANKU_TEST_HIGH_RATE_WALLPAPER") else {
            return;
        };
        #[cfg(target_os = "macos")]
        assert!(native_video_compatible(&path.to_string_lossy()));
        let mut reader = Reader::open(Path::new(&path)).unwrap();
        let started = std::time::Instant::now();
        let first = reader.frame(0.7).unwrap();
        let warmup = started.elapsed();
        let steady = std::time::Instant::now();
        for frame in 1..=30 {
            let pixels = reader.frame(0.7 + f64::from(frame) / 60.0).unwrap();
            assert_eq!(
                pixels.data.len(),
                (pixels.width * pixels.height * 4) as usize
            );
        }
        println!(
            "wallpaper warmup={warmup:?}, 30 sequential frames={:?}",
            steady.elapsed()
        );
        assert_eq!(first.data, reader.frame(0.7).unwrap().data);
    }
    #[test]
    fn loops_at_media_duration_and_rejects_invalid_clocks() {
        assert_eq!(loop_time(6.25, 2.0), 0.25);
        assert_eq!(loop_time(2.0, 2.0), 0.0);
        assert_eq!(loop_time(-1.0, 2.0), 0.0);
        assert_eq!(loop_time(f64::NAN, 2.0), 0.0);
        assert_eq!(loop_time(1.0, 0.0), 0.0);
    }
    #[tokio::test]
    async fn decodes_loop_and_backwards_seek() {
        let Some(path) = std::env::var_os("JIANKU_TEST_WALLPAPER_VIDEO") else {
            return;
        };
        let mut video = VideoBackground::new(path.to_string_lossy().into_owned(), false).unwrap();
        let first = video.frame(0.0, false).await.unwrap();
        let later = video.frame(0.8, false).await.unwrap();
        let backwards = video.frame(0.0, false).await.unwrap();
        assert_eq!(first.data, backwards.data);
        let looped = video.frame(2.0, false).await.unwrap();
        assert_eq!(looped.data, later.data);
        assert_ne!(first.data, later.data);
        assert_eq!(first.data.len(), (first.width * first.height * 4) as usize);
    }
}
