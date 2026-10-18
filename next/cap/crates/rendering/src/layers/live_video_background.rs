use std::{
    cell::RefCell,
    collections::HashMap,
    sync::atomic::{AtomicU64, Ordering},
};

use cidre::cv;
use dispatch2::DispatchQueue;
use objc2::{AnyThread, MainThreadMarker, rc::Retained, runtime::AnyObject};
use objc2_av_foundation::{
    AVPlayer, AVPlayerAudiovisualBackgroundPlaybackPolicy, AVPlayerItem, AVPlayerItemVideoOutput,
};
use objc2_core_media::CMTime;
use objc2_foundation::{NSDictionary, NSNumber, NSString, NSURL};
use tokio::sync::oneshot;

use crate::DecodedFrame;

thread_local! {
    static PLAYERS: RefCell<HashMap<u64, Player>> = RefCell::new(HashMap::new());
}
static NEXT_PLAYER: AtomicU64 = AtomicU64::new(1);

pub(super) struct LiveVideoBackground {
    id: u64,
    path: String,
}

impl LiveVideoBackground {
    pub fn new(path: String) -> Self {
        Self {
            id: NEXT_PLAYER.fetch_add(1, Ordering::Relaxed),
            path,
        }
    }

    pub async fn frame(&self, time: f64, playing: bool) -> Result<Option<DecodedFrame>, String> {
        let (send, receive) = oneshot::channel();
        let id = self.id;
        let path = self.path.clone();
        DispatchQueue::main().exec_async(move || {
            let result = PLAYERS.with(|players| {
                let mut players = players.borrow_mut();
                if let std::collections::hash_map::Entry::Vacant(entry) = players.entry(id) {
                    entry.insert(Player::new(&path)?);
                }
                players
                    .get_mut(&id)
                    .ok_or("壁纸播放器未就绪".to_string())?
                    .frame(time, playing)
            });
            let _ = send.send(result);
        });
        tokio::time::timeout(std::time::Duration::from_secs(1), receive)
            .await
            .map_err(|error| error.to_string())?
            .map_err(|error| error.to_string())?
    }
}

impl Drop for LiveVideoBackground {
    fn drop(&mut self) {
        let id = self.id;
        DispatchQueue::main().exec_async(move || {
            PLAYERS.with(|players| {
                players.borrow_mut().remove(&id);
            });
        });
    }
}

struct Player {
    player: Retained<AVPlayer>,
    item: Retained<AVPlayerItem>,
    output: Retained<AVPlayerItemVideoOutput>,
    last_request: Option<f64>,
    playing: bool,
}

impl Player {
    fn new(path: &str) -> Result<Self, String> {
        let main = MainThreadMarker::new().ok_or("壁纸播放器需要主线程")?;
        unsafe {
            let url = NSURL::fileURLWithPath(&NSString::from_str(path));
            let item = AVPlayerItem::playerItemWithURL(&url, main);
            let key = NSString::from_str("PixelFormatType");
            let format = NSNumber::new_u32(u32::from_be_bytes(*b"420v"));
            let metal_key = NSString::from_str("MetalCompatibility");
            let metal = NSNumber::new_bool(true);
            let surface_key = NSString::from_str("IOSurfaceProperties");
            let surface = NSDictionary::<NSString, AnyObject>::new();
            let attributes = NSDictionary::from_slices(
                &[&*key, &*metal_key, &*surface_key],
                &[
                    &*format as &AnyObject,
                    &*metal as &AnyObject,
                    &*surface as &AnyObject,
                ],
            );
            let output = AVPlayerItemVideoOutput::initWithPixelBufferAttributes(
                AVPlayerItemVideoOutput::alloc(),
                Some(&attributes),
            );
            output.setSuppressesPlayerRendering(true);
            item.addOutput(&output);
            let player = AVPlayer::playerWithPlayerItem(Some(&item), main);
            player.setMuted(true);
            player.setAutomaticallyWaitsToMinimizeStalling(false);
            player.setAudiovisualBackgroundPlaybackPolicy(
                AVPlayerAudiovisualBackgroundPlaybackPolicy::ContinuesIfPossible,
            );
            Ok(Self {
                player,
                item,
                output,
                last_request: None,
                playing: false,
            })
        }
    }

    fn frame(&mut self, time: f64, playing: bool) -> Result<Option<DecodedFrame>, String> {
        unsafe {
            if let Some(error) = self.player.error() {
                return Err(error.to_string());
            }
            let duration = self.item.duration().seconds();
            let time = if duration.is_finite() && duration > 0.0 {
                super::video_background::loop_time(time, duration)
            } else {
                time.max(0.0)
            };
            let seek = self
                .last_request
                .is_none_or(|last| time < last - 0.0001 || time > last + 2.0)
                || (playing && !self.playing);
            if seek {
                let target = CMTime::with_seconds(time, 600_000);
                let zero = CMTime::new(0, 600_000);
                self.item
                    .seekToTime_toleranceBefore_toleranceAfter_completionHandler(
                        target, zero, zero, None,
                    );
            }
            if playing != self.playing {
                if playing {
                    self.player.play();
                } else {
                    self.player.pause();
                }
                self.playing = playing;
            }
            self.last_request = Some(time);
            let current = self.player.currentTime();
            if !self.output.hasNewPixelBufferForItemTime(current) {
                return Ok(None);
            }
            let Some(buffer) = self
                .output
                .copyPixelBufferForItemTime_itemTimeForDisplay(current, std::ptr::null_mut())
            else {
                return Ok(None);
            };
            // Both bindings refer to the same retained CVPixelBuffer CF object.
            let image = &*(std::ptr::from_ref(&*buffer).cast::<cv::ImageBuf>());
            if image.pixel_format() != cv::PixelFormat::_420V {
                return Err("动态壁纸返回了不支持的像素格式".into());
            }
            Ok(Some(DecodedFrame::new_nv12_with_image_buf(
                image.width() as u32,
                image.height() as u32,
                image.plane_bytes_per_row(0) as u32,
                image.plane_bytes_per_row(1) as u32,
                image.retained(),
            )))
        }
    }
}

impl Drop for Player {
    fn drop(&mut self) {
        unsafe {
            self.player.pause();
        }
    }
}
