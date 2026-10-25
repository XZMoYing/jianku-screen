use std::path::Path;

use cap_video_decode::AVAssetReaderDecoder;
use tokio::runtime::Handle;

use crate::DecodedFrame;

use super::video_background::loop_time;

pub(super) struct PreciseVideoBackground {
    decoder: AVAssetReaderDecoder,
    duration: f64,
    decoded_time: f64,
    decoded_frame: Option<DecodedFrame>,
    decode_request: Option<f64>,
    last: Option<(f64, DecodedFrame)>,
    ahead: Option<(f64, DecodedFrame)>,
    step: Option<f64>,
}

impl PreciseVideoBackground {
    #[cfg(test)]
    pub fn open(path: &Path, handle: Handle) -> Result<Self, String> {
        Self::open_with_cancel(path, handle, || false)
    }

    pub fn open_with_cancel(
        path: &Path,
        handle: Handle,
        cancelled: impl Fn() -> bool,
    ) -> Result<Self, String> {
        if cancelled() {
            return Err("壁纸定位已取消".into());
        }
        let input = ffmpeg::format::input(path).map_err(|error| error.to_string())?;
        let stream = input
            .streams()
            .best(ffmpeg::media::Type::Video)
            .ok_or("壁纸没有视频轨道")?;
        let duration = if stream.duration() > 0 {
            stream.duration() as f64 * f64::from(stream.time_base())
        } else {
            input.duration() as f64 / 1_000_000.0
        };
        Ok(Self {
            decoder: AVAssetReaderDecoder::new_nv12_with_cancel(path.into(), handle, cancelled)?,
            duration,
            decoded_time: -1.0,
            decoded_frame: None,
            decode_request: None,
            last: None,
            ahead: None,
            step: None,
        })
    }

    #[cfg(test)]
    pub fn frame(&mut self, time: f64) -> Result<DecodedFrame, String> {
        self.frame_with_cancel(time, || false)
    }

    pub fn frame_with_cancel(
        &mut self,
        time: f64,
        cancelled: impl Fn() -> bool,
    ) -> Result<DecodedFrame, String> {
        if let Some((previous, frame)) = &self.last
            && self.same_request(time, *previous)
        {
            return Ok(frame.clone());
        }
        self.step = self.last.as_ref().and_then(|(previous, _)| {
            let step = time - previous;
            (step > 0.000_001 && step <= 0.1).then_some(step)
        });
        let frame = if self
            .ahead
            .as_ref()
            .is_some_and(|(target, _)| self.same_request(time, *target))
        {
            self.ahead.take().ok_or("预取壁纸未就绪")?.1
        } else {
            self.ahead = None;
            self.sample(time, &cancelled)?
        };
        self.last = Some((time, frame.clone()));
        Ok(frame)
    }

    fn same_request(&self, a: f64, b: f64) -> bool {
        (a - b).abs() < 0.000_001
            && (loop_time(a, self.duration) - loop_time(b, self.duration)).abs() < 0.000_001
    }

    pub fn prefetch(&mut self) {
        if let Some(step) = self.step
            && let Some((previous, _)) = &self.last
        {
            let target = previous + step;
            if let Ok(frame) = self.sample(target, &|| false) {
                self.ahead = Some((target, frame));
            }
        }
    }

    #[cfg(test)]
    pub fn decoded_time(&self) -> f64 {
        self.decoded_time
    }

    fn sample(&mut self, time: f64, cancelled: &impl Fn() -> bool) -> Result<DecodedFrame, String> {
        if cancelled() {
            return Err("壁纸定位已取消".into());
        }
        let time = loop_time(time, self.duration);
        if self
            .decode_request
            .is_some_and(|previous| time < previous - 0.0001)
            || time > self.decoded_time + 2.0
        {
            self.decoder.reset(time as f32)?;
            self.decoded_time = -1.0;
            self.decoded_frame = None;
        }
        self.decode_request = Some(time);
        while self.decoded_frame.is_none() || self.decoded_time + 0.0001 < time {
            if cancelled() {
                return Err("壁纸定位已取消".into());
            }
            let Some(sample) = self.decoder.frames().next() else {
                break;
            };
            let sample = sample.map_err(|error| error.to_string())?;
            self.decoded_time = sample.pts().as_secs();
            let image = sample.image_buf().ok_or("壁纸样本没有图像")?;
            if image.pixel_format() != cidre::cv::PixelFormat::_420V {
                return Err("精确壁纸样本不是 NV12".into());
            }
            self.decoded_frame = Some(DecodedFrame::new_nv12_with_image_buf(
                image.width() as u32,
                image.height() as u32,
                image.plane_bytes_per_row(0) as u32,
                image.plane_bytes_per_row(1) as u32,
                image.retained(),
            ));
        }
        self.decoded_frame
            .clone()
            .ok_or("无法解码精确壁纸帧".into())
    }
}
