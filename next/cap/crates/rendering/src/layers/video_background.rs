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
type Request = (f64, oneshot::Sender<Result<VideoPixels, String>>);
pub(crate) struct VideoBackground {
    pub path: String,
    sender: mpsc::Sender<Request>,
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

impl VideoBackground {
    pub fn new(path: String) -> Result<Self, String> {
        let (sender, receiver) = mpsc::channel::<Request>();
        let worker_path = PathBuf::from(&path);
        std::thread::Builder::new()
            .name("wallpaper-video".into())
            .spawn(move || {
                let mut reader = match Reader::open(&worker_path) {
                    Ok(reader) => reader,
                    Err(error) => {
                        for (_, reply) in receiver {
                            let _ = reply.send(Err(error.clone()));
                        }
                        return;
                    }
                };
                for (time, reply) in receiver {
                    if !reply.is_closed() {
                        let _ = reply.send(reader.frame(time));
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(Self { path, sender })
    }
    pub async fn frame(&self, time: f64) -> Result<VideoPixels, String> {
        let (reply, receive) = oneshot::channel();
        self.sender.send((time, reply)).map_err(|e| e.to_string())?;
        tokio::time::timeout(std::time::Duration::from_secs(15), receive)
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?
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
        if self.last_request >= 0.0
            && (time < self.last_request - 0.0001 || time > self.last_time + 2.0)
        {
            self.decoder.reset(time as f32).map_err(|e| e.to_string())?;
            self.last_frame = None;
            self.last_pixels = None;
            self.last_time = -1.0;
        }
        self.last_request = time;
        while self.last_frame.is_none() || self.last_time + 0.0001 < time {
            let Some(frame) = self.decoder.frames().next() else {
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
        let source = self.last_frame.as_ref().ok_or("无法解码壁纸帧")?;
        let scale = (2560.0 / f64::from(source.width().max(source.height()))).min(1.0);
        let width = (f64::from(source.width()) * scale).round().max(1.0) as u32;
        let height = (f64::from(source.height()) * scale).round().max(1.0) as u32;
        if self.scaler.is_none() {
            self.scaler = Some(
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
        self.scaler
            .as_mut()
            .ok_or("无法转换壁纸帧")?
            .run(source, &mut rgba)
            .map_err(|e| e.to_string())?;
        let data = rgba
            .data(0)
            .chunks(rgba.stride(0))
            .take(height as usize)
            .flat_map(|row| row[..width as usize * 4].iter().copied())
            .collect();
        let pixels = VideoPixels {
            data: Arc::new(data),
            width,
            height,
        };
        self.last_pixels = Some((self.last_time, pixels.clone()));
        Ok(pixels)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
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
        let video = VideoBackground::new(path.to_string_lossy().into_owned()).unwrap();
        let first = video.frame(0.0).await.unwrap();
        let later = video.frame(0.8).await.unwrap();
        let backwards = video.frame(0.0).await.unwrap();
        assert_eq!(first.data, backwards.data);
        let looped = video.frame(2.0).await.unwrap();
        assert_eq!(looped.data, later.data);
        assert_ne!(first.data, later.data);
        assert_eq!(first.data.len(), (first.width * first.height * 4) as usize);
    }
}
