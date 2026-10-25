use std::collections::VecDeque;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use cidre::{
    arc::{self, R},
    av::{self},
    cm,
    cv::{self},
    ns,
};
use ffmpeg::{codec as avcodec, format as avformat};
use tokio::runtime::Handle as TokioHandle;

#[derive(Clone)]
pub struct KeyframeIndex {
    keyframes: Vec<(u32, f64)>,
    fps: f64,
    duration_secs: f64,
    pixel_format: Option<cv::PixelFormat>,
    width: u32,
    height: u32,
}

impl KeyframeIndex {
    pub fn build(path: &Path) -> Result<Self, String> {
        Self::build_with_pixel_format(path, None)
    }

    fn build_with_pixel_format(
        path: &Path,
        output_format: Option<cv::PixelFormat>,
    ) -> Result<Self, String> {
        Self::build_with_pixel_format_and_cancel(path, output_format, &|| false)
    }

    fn build_with_pixel_format_and_cancel(
        path: &Path,
        output_format: Option<cv::PixelFormat>,
        cancelled: &impl Fn() -> bool,
    ) -> Result<Self, String> {
        if cancelled() {
            return Err("Video index request cancelled".into());
        }
        let build_start = std::time::Instant::now();

        let mut input = avformat::input(path)
            .map_err(|e| format!("Failed to open video for keyframe scan: {e}"))?;

        let (stream_index, time_base, fps, duration_secs, pixel_format, width, height) = {
            let video_stream = input
                .streams()
                .best(ffmpeg::media::Type::Video)
                .ok_or("No video stream found")?;

            let stream_index = video_stream.index();
            let time_base = video_stream.time_base();
            let fps = {
                let rate = video_stream.avg_frame_rate();
                if rate.denominator() == 0 {
                    30.0
                } else {
                    rate.numerator() as f64 / rate.denominator() as f64
                }
            };

            let duration_secs = {
                let duration = video_stream.duration();
                if duration > 0 {
                    duration as f64 * time_base.numerator() as f64 / time_base.denominator() as f64
                } else {
                    0.0
                }
            };

            let decoder = avcodec::Context::from_parameters(video_stream.parameters())
                .map_err(|e| format!("decoder context / {e}"))?
                .decoder()
                .video()
                .map_err(|e| format!("video decoder / {e}"))?;

            let pixel_format =
                output_format.or_else(|| pixel_to_pixel_format(decoder.format()).ok());
            let width = decoder.width();
            let height = decoder.height();

            (
                stream_index,
                time_base,
                fps,
                duration_secs,
                pixel_format,
                width,
                height,
            )
        };

        let mut keyframes = Vec::new();

        for (stream, packet) in input.packets() {
            if cancelled() {
                return Err("Video index request cancelled".into());
            }
            if stream.index() != stream_index {
                continue;
            }

            if packet.is_key() {
                let pts = packet.pts().unwrap_or(0);
                let time_secs =
                    pts as f64 * time_base.numerator() as f64 / time_base.denominator() as f64;
                let frame_number = (time_secs * fps).round() as u32;
                keyframes.push((frame_number, time_secs));
            }
        }

        let elapsed = build_start.elapsed();
        tracing::info!(
            path = %path.display(),
            keyframe_count = keyframes.len(),
            fps = fps,
            duration_secs = duration_secs,
            build_ms = elapsed.as_millis(),
            "Built keyframe index"
        );

        Ok(Self {
            keyframes,
            fps,
            duration_secs,
            pixel_format,
            width,
            height,
        })
    }

    pub fn nearest_keyframe_before(&self, target_frame: u32) -> Option<(u32, f64)> {
        if self.keyframes.is_empty() {
            return None;
        }

        let pos = self
            .keyframes
            .binary_search_by_key(&target_frame, |(frame, _)| *frame);

        match pos {
            Ok(i) => Some(self.keyframes[i]),
            Err(0) => None,
            Err(i) => Some(self.keyframes[i - 1]),
        }
    }

    pub fn nearest_keyframe_after(&self, target_frame: u32) -> Option<(u32, f64)> {
        if self.keyframes.is_empty() {
            return None;
        }

        let pos = self
            .keyframes
            .binary_search_by_key(&target_frame, |(frame, _)| *frame);

        let idx = match pos {
            Ok(i) => {
                if i + 1 < self.keyframes.len() {
                    i + 1
                } else {
                    i
                }
            }
            Err(i) => {
                if i < self.keyframes.len() {
                    i
                } else {
                    return None;
                }
            }
        };

        Some(self.keyframes[idx])
    }

    pub fn get_strategic_positions(&self, num_positions: usize) -> Vec<f64> {
        if self.keyframes.is_empty() || num_positions == 0 {
            return vec![0.0];
        }

        let total_keyframes = self.keyframes.len();
        if total_keyframes <= num_positions {
            return self.keyframes.iter().map(|(_, time)| *time).collect();
        }

        let mut positions: Vec<f64> = Vec::with_capacity(num_positions);

        positions.push(self.keyframes[0].1);

        if num_positions > 2 {
            let inner_count = num_positions - 2;
            let step = (total_keyframes - 1) as f64 / (inner_count + 1) as f64;
            for i in 1..=inner_count {
                let idx = (step * i as f64).round() as usize;
                let idx = idx.min(total_keyframes - 2);
                positions.push(self.keyframes[idx].1);
            }
        }

        if num_positions > 1 {
            positions.push(self.keyframes[total_keyframes - 1].1);
        }

        positions
    }

    pub fn fps(&self) -> f64 {
        self.fps
    }

    pub fn duration_secs(&self) -> f64 {
        self.duration_secs
    }

    pub fn keyframe_count(&self) -> usize {
        self.keyframes.len()
    }

    pub fn keyframes(&self) -> &[(u32, f64)] {
        &self.keyframes
    }

    pub fn cached_video_info(&self) -> Option<(cv::PixelFormat, u32, u32)> {
        self.pixel_format.map(|pf| (pf, self.width, self.height))
    }
}

const NV12_INDEX_CACHE_ENTRIES: usize = 8;
const NV12_INDEX_CACHE_BYTES: usize = 8 * 1024 * 1024;
static NV12_INDEX_CACHE: OnceLock<Mutex<Nv12IndexCache>> = OnceLock::new();

#[derive(PartialEq, Eq)]
struct VideoFileIdentity {
    path: PathBuf,
    device: u64,
    inode: u64,
    length: u64,
    modified: (i64, i64),
    changed: (i64, i64),
}

impl VideoFileIdentity {
    fn read(path: &Path) -> Result<Self, String> {
        let path = path.canonicalize().map_err(|error| error.to_string())?;
        let metadata = path.metadata().map_err(|error| error.to_string())?;
        Ok(Self {
            path,
            device: metadata.dev(),
            inode: metadata.ino(),
            length: metadata.len(),
            modified: (metadata.mtime(), metadata.mtime_nsec()),
            changed: (metadata.ctime(), metadata.ctime_nsec()),
        })
    }
}

#[derive(Default)]
struct Nv12IndexCache {
    entries: VecDeque<(VideoFileIdentity, Arc<KeyframeIndex>)>,
    bytes: usize,
}

impl Nv12IndexCache {
    fn get(&mut self, identity: &VideoFileIdentity) -> Option<Arc<KeyframeIndex>> {
        let position = self.entries.iter().position(|(key, _)| key == identity)?;
        let entry = self.entries.remove(position)?;
        let index = entry.1.clone();
        self.entries.push_back(entry);
        Some(index)
    }

    fn insert(&mut self, identity: VideoFileIdentity, index: Arc<KeyframeIndex>) {
        let size = Self::index_bytes(&index);
        self.entries.retain(|(key, _)| key.path != identity.path);
        self.bytes = self
            .entries
            .iter()
            .map(|(_, index)| Self::index_bytes(index))
            .sum();
        if size > NV12_INDEX_CACHE_BYTES {
            return;
        }
        while self.entries.len() >= NV12_INDEX_CACHE_ENTRIES
            || self.bytes.saturating_add(size) > NV12_INDEX_CACHE_BYTES
        {
            let Some((_, removed)) = self.entries.pop_front() else {
                break;
            };
            self.bytes = self.bytes.saturating_sub(Self::index_bytes(&removed));
        }
        self.bytes += size;
        self.entries.push_back((identity, index));
    }

    fn index_bytes(index: &KeyframeIndex) -> usize {
        std::mem::size_of::<KeyframeIndex>()
            + index.keyframes.capacity() * std::mem::size_of::<(u32, f64)>()
    }
}

fn cached_nv12_index(
    cache: &Mutex<Nv12IndexCache>,
    path: &Path,
    cancelled: &impl Fn() -> bool,
    build: impl FnOnce() -> Result<KeyframeIndex, String>,
) -> Result<Arc<KeyframeIndex>, String> {
    if cancelled() {
        return Err("Video index request cancelled".into());
    }
    let identity = VideoFileIdentity::read(path)?;
    if let Some(index) = cache
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .get(&identity)
    {
        return Ok(index);
    }
    let index = Arc::new(build()?);
    if cancelled() {
        return Err("Video index request cancelled".into());
    }
    if VideoFileIdentity::read(path)? != identity {
        return Err("Video changed while building its index".into());
    }
    cache
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .insert(identity, index.clone());
    Ok(index)
}

fn compute_seek_time(keyframe_index: Option<&Arc<KeyframeIndex>>, requested_time: f32) -> f32 {
    if let Some(kf_index) = keyframe_index {
        let fps = kf_index.fps();
        let target_frame = (requested_time as f64 * fps).round() as u32;
        if let Some((_, keyframe_time)) = kf_index.nearest_keyframe_before(target_frame) {
            return keyframe_time as f32;
        }
        if let Some((_, first_keyframe_time)) = kf_index.keyframes().first() {
            return *first_keyframe_time as f32;
        }
    }
    requested_time
}

pub struct AVAssetReaderDecoder {
    path: PathBuf,
    pixel_format: cv::PixelFormat,
    tokio_handle: TokioHandle,
    track_output: R<av::AssetReaderTrackOutput>,
    reader: R<av::AssetReader>,
    width: u32,
    height: u32,
    keyframe_index: Option<Arc<KeyframeIndex>>,
    current_position_secs: f32,
}

impl AVAssetReaderDecoder {
    pub fn new_nv12(path: PathBuf, tokio_handle: TokioHandle) -> Result<Self, String> {
        Self::new_nv12_with_cancel(path, tokio_handle, || false)
    }

    pub fn new_nv12_with_cancel(
        path: PathBuf,
        tokio_handle: TokioHandle,
        cancelled: impl Fn() -> bool,
    ) -> Result<Self, String> {
        let pixel_format = cv::PixelFormat::_420V;
        let index = cached_nv12_index(
            NV12_INDEX_CACHE.get_or_init(Mutex::default),
            &path,
            &cancelled,
            || {
                KeyframeIndex::build_with_pixel_format_and_cancel(
                    &path,
                    Some(pixel_format),
                    &cancelled,
                )
            },
        )?;
        if cancelled() {
            return Err("Video index request cancelled".into());
        }
        let (_, width, height) = index
            .cached_video_info()
            .ok_or("Video dimensions unavailable")?;
        let (track_output, mut reader) =
            Self::get_reader_track_output(&path, 0.0, &tokio_handle, pixel_format, width, height)?;
        if cancelled() {
            reader.cancel_reading();
            return Err("Video reader request cancelled".into());
        }
        Ok(Self {
            path,
            pixel_format,
            tokio_handle,
            track_output,
            reader,
            width,
            height,
            keyframe_index: Some(index),
            current_position_secs: 0.0,
        })
    }

    pub fn new(path: PathBuf, tokio_handle: TokioHandle) -> Result<Self, String> {
        Self::new_at_position(path, tokio_handle, 0.0)
    }

    pub fn new_at_position(
        path: PathBuf,
        tokio_handle: TokioHandle,
        start_time: f32,
    ) -> Result<Self, String> {
        let keyframe_index = match KeyframeIndex::build(&path) {
            Ok(index) => Some(Arc::new(index)),
            Err(e) => {
                tracing::warn!(
                    path = %path.display(),
                    error = %e,
                    "Failed to build keyframe index, seeking may be slower"
                );
                None
            }
        };

        Self::new_with_keyframe_index(path, tokio_handle, start_time, keyframe_index)
    }

    pub fn new_with_keyframe_index(
        path: PathBuf,
        tokio_handle: TokioHandle,
        start_time: f32,
        keyframe_index: Option<Arc<KeyframeIndex>>,
    ) -> Result<Self, String> {
        let (pixel_format, width, height) = if let Some(info) = keyframe_index
            .as_ref()
            .and_then(|ki| ki.cached_video_info())
        {
            info
        } else {
            let input = ffmpeg::format::input(&path)
                .map_err(|e| format!("Failed to open video input '{}': {e}", path.display()))?;

            let input_stream = input
                .streams()
                .best(ffmpeg::media::Type::Video)
                .ok_or_else(|| format!("No video stream in '{}'", path.display()))?;

            let decoder = avcodec::Context::from_parameters(input_stream.parameters())
                .map_err(|e| format!("decoder context / {e}"))?
                .decoder()
                .video()
                .map_err(|e| format!("video decoder / {e}"))?;

            (
                pixel_to_pixel_format(decoder.format())?,
                decoder.width(),
                decoder.height(),
            )
        };

        let seek_time = compute_seek_time(keyframe_index.as_ref(), start_time);

        let (track_output, reader) = Self::get_reader_track_output(
            &path,
            seek_time,
            &tokio_handle,
            pixel_format,
            width,
            height,
        )?;

        Ok(Self {
            path,
            pixel_format,
            tokio_handle,
            track_output,
            reader,
            width,
            height,
            keyframe_index,
            current_position_secs: seek_time,
        })
    }

    pub fn reset(&mut self, requested_time: f32) -> Result<(), String> {
        self.reader.cancel_reading();

        let seek_time = compute_seek_time(self.keyframe_index.as_ref(), requested_time);

        (self.track_output, self.reader) = Self::get_reader_track_output(
            &self.path,
            seek_time,
            &self.tokio_handle,
            self.pixel_format,
            self.width,
            self.height,
        )?;

        self.current_position_secs = seek_time;

        Ok(())
    }

    pub fn current_position_secs(&self) -> f32 {
        self.current_position_secs
    }

    pub fn update_position(&mut self, position_secs: f32) {
        self.current_position_secs = position_secs;
    }

    pub fn path(&self) -> &PathBuf {
        &self.path
    }

    pub fn pixel_format(&self) -> cv::PixelFormat {
        self.pixel_format
    }

    pub fn take_keyframe_index(&mut self) -> Option<Arc<KeyframeIndex>> {
        self.keyframe_index.take()
    }

    pub fn keyframe_index(&self) -> Option<&Arc<KeyframeIndex>> {
        self.keyframe_index.as_ref()
    }

    pub fn keyframe_index_arc(&self) -> Option<Arc<KeyframeIndex>> {
        self.keyframe_index.clone()
    }

    fn get_reader_track_output(
        path: &Path,
        time: f32,
        handle: &TokioHandle,
        pixel_format: cv::PixelFormat,
        width: u32,
        height: u32,
    ) -> Result<(R<av::AssetReaderTrackOutput>, R<av::AssetReader>), String> {
        let asset = av::UrlAsset::with_url(
            &ns::Url::with_fs_path_str(
                path.to_str()
                    .ok_or_else(|| format!("Invalid UTF-8 in path: {path:?}"))?,
                false,
            ),
            None,
        )
        .ok_or_else(|| format!("UrlAsset::with_url{{{path:?}}}"))?;

        let mut reader = av::AssetReader::with_asset(&asset)
            .map_err(|e| format!("AssetReader::with_asset: {e}"))?;

        let time_range = cm::TimeRange {
            start: cm::Time::with_secs(time as f64, 600_000),
            duration: cm::Time::infinity(),
        };

        reader.set_time_range(time_range);

        let tracks = handle
            .block_on(asset.load_tracks_with_media_type(av::MediaType::video()))
            .map_err(|e| format!("asset.load_tracks_with_media_type: {e}"))?;

        let track = tracks.get(0).map_err(|e| e.to_string())?;

        let mut reader_track_output = av::AssetReaderTrackOutput::with_track(
            &track,
            Some(&ns::Dictionary::with_keys_values(
                &[
                    cv::pixel_buffer::keys::pixel_format().as_ns(),
                    cv::pixel_buffer::keys::width().as_ns(),
                    cv::pixel_buffer::keys::height().as_ns(),
                ],
                &[
                    pixel_format.to_cf_number().as_ns().as_id_ref(),
                    ns::Number::with_u32(width).as_id_ref(),
                    ns::Number::with_u32(height).as_id_ref(),
                ],
            )),
        )
        .map_err(|e| format!("asset.reader_track_output{{{pixel_format:?}}}): {e}"))?;

        reader_track_output.set_always_copies_sample_data(false);

        reader
            .add_output(&reader_track_output)
            .map_err(|e| format!("reader.add_output: {e}"))?;

        reader
            .start_reading()
            .map_err(|e| format!("reader.start_reading: {e}"))?;

        Ok((reader_track_output, reader))
    }

    pub fn frames(&mut self) -> FramesIter<'_> {
        FramesIter {
            track_output: &mut self.track_output,
        }
    }

    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }
}

pub struct FramesIter<'a> {
    track_output: &'a mut av::AssetReaderTrackOutput,
}

impl<'a> Iterator for FramesIter<'a> {
    type Item = ns::ExResult<'static, arc::R<cm::SampleBuf>>;

    fn next(&mut self) -> Option<Self::Item> {
        self.track_output.next_sample_buf().transpose()
    }
}

pub fn pixel_to_pixel_format(pixel: avformat::Pixel) -> Result<cv::PixelFormat, String> {
    match pixel {
        avformat::Pixel::NV12 => Ok(cv::PixelFormat::_420V),
        avformat::Pixel::YUV420P => Ok(cv::PixelFormat::_420V),
        avformat::Pixel::RGBA => Ok(cv::PixelFormat::_32_RGBA),
        avformat::Pixel::BGRA => Ok(cv::PixelFormat::_32_BGRA),
        other => {
            tracing::error!(
                pixel_format = ?other,
                "Unhandled pixel format encountered - no mapping to cv::PixelFormat available"
            );
            Err(format!(
                "Unsupported pixel format: {other:?}. Supported formats: NV12, YUV420P, RGBA, BGRA"
            ))
        }
    }
}

pub fn pixel_format_to_pixel(format: cv::PixelFormat) -> avformat::Pixel {
    match format {
        cv::PixelFormat::_420V => avformat::Pixel::NV12,
        cv::PixelFormat::_32_RGBA => avformat::Pixel::RGBA,
        cv::PixelFormat::_32_BGRA => avformat::Pixel::BGRA,
        _ => avformat::Pixel::RGBA,
    }
}

#[cfg(test)]
mod nv12_index_cache_tests {
    use super::*;
    use std::cell::Cell;
    use std::fs::{File, FileTimes};

    fn index(keyframes: usize) -> KeyframeIndex {
        KeyframeIndex {
            keyframes: vec![(0, 0.0); keyframes],
            fps: 60.0,
            duration_secs: 60.0,
            pixel_format: Some(cv::PixelFormat::_420V),
            width: 1920,
            height: 1080,
        }
    }

    #[test]
    fn unchanged_file_reuses_index_without_holding_lock_during_scan() {
        let file = tempfile::NamedTempFile::new().unwrap();
        let cache = Mutex::default();
        let first = cached_nv12_index(&cache, file.path(), &|| false, || {
            assert!(cache.try_lock().is_ok());
            Ok(index(3))
        })
        .unwrap();
        let second = cached_nv12_index(&cache, file.path(), &|| false, || {
            panic!("Unchanged video must not be scanned twice")
        })
        .unwrap();
        assert!(Arc::ptr_eq(&first, &second));
    }

    #[test]
    fn rewritten_and_replaced_files_invalidate_cached_index() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("wallpaper.mov");
        std::fs::write(&path, b"old").unwrap();
        let cache = Mutex::default();
        let first = cached_nv12_index(&cache, &path, &|| false, || Ok(index(3))).unwrap();
        std::fs::write(&path, b"changed file").unwrap();
        let second = cached_nv12_index(&cache, &path, &|| false, || Ok(index(5))).unwrap();
        assert!(!Arc::ptr_eq(&first, &second));
        let modified = path.metadata().unwrap().modified().unwrap();
        let replacement = directory.path().join("replacement.mov");
        std::fs::write(&replacement, b"another file").unwrap();
        File::options()
            .write(true)
            .open(&replacement)
            .unwrap()
            .set_times(FileTimes::new().set_modified(modified))
            .unwrap();
        std::fs::rename(replacement, &path).unwrap();
        let third = cached_nv12_index(&cache, &path, &|| false, || Ok(index(7))).unwrap();
        assert!(!Arc::ptr_eq(&second, &third));
        assert_eq!(cache.lock().unwrap().entries.len(), 1);
    }

    #[test]
    fn cancelled_or_changed_scans_do_not_publish_an_index() {
        let file = tempfile::NamedTempFile::new().unwrap();
        let cache = Mutex::default();
        let cancelled = Cell::new(false);
        assert!(
            cached_nv12_index(&cache, file.path(), &|| cancelled.get(), || {
                cancelled.set(true);
                Ok(index(3))
            })
            .is_err()
        );
        assert!(cache.lock().unwrap().entries.is_empty());
        assert!(
            cached_nv12_index(&cache, file.path(), &|| false, || {
                std::fs::write(file.path(), b"changed during scan").unwrap();
                Ok(index(3))
            })
            .is_err()
        );
        assert!(cache.lock().unwrap().entries.is_empty());
        assert!(
            cached_nv12_index(&cache, file.path(), &|| true, || {
                panic!("Cancelled requests must not begin scanning")
            })
            .is_err()
        );
    }

    #[test]
    fn cache_evicts_least_recent_entries_and_bounds_retained_bytes() {
        let directory = tempfile::tempdir().unwrap();
        let mut cache = Nv12IndexCache::default();
        let identities: Vec<_> = (0..=NV12_INDEX_CACHE_ENTRIES)
            .map(|number| {
                let path = directory.path().join(format!("{number}.mov"));
                std::fs::write(&path, b"test").unwrap();
                VideoFileIdentity::read(&path).unwrap()
            })
            .collect();
        for identity in &identities[..NV12_INDEX_CACHE_ENTRIES] {
            cache.insert(
                VideoFileIdentity::read(&identity.path).unwrap(),
                Arc::new(index(3)),
            );
        }
        assert!(cache.get(&identities[0]).is_some());
        cache.insert(
            VideoFileIdentity::read(&identities[NV12_INDEX_CACHE_ENTRIES].path).unwrap(),
            Arc::new(index(3)),
        );
        assert!(cache.get(&identities[0]).is_some());
        assert!(cache.get(&identities[1]).is_none());
        assert_eq!(cache.entries.len(), NV12_INDEX_CACHE_ENTRIES);
        let large = Arc::new(index(NV12_INDEX_CACHE_BYTES / 32));
        for identity in &identities {
            cache.insert(
                VideoFileIdentity::read(&identity.path).unwrap(),
                large.clone(),
            );
        }
        assert!(cache.bytes <= NV12_INDEX_CACHE_BYTES);
        assert_eq!(cache.entries.len(), 1);
        cache.insert(
            VideoFileIdentity::read(&identities[0].path).unwrap(),
            Arc::new(index(NV12_INDEX_CACHE_BYTES / 16 + 1)),
        );
        assert!(cache.get(&identities[0]).is_none());
        assert!(cache.bytes <= NV12_INDEX_CACHE_BYTES);
    }

    #[test]
    fn synthetic_video_reopens_reuse_the_same_precise_index() {
        let Some(path) = std::env::var_os("JIANKU_TEST_INDEX_CACHE_VIDEO") else {
            return;
        };
        let path = PathBuf::from(path);
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let started = std::time::Instant::now();
        let first = AVAssetReaderDecoder::new_nv12(path.clone(), runtime.handle().clone()).unwrap();
        let first_elapsed = started.elapsed();
        let started = std::time::Instant::now();
        let second =
            AVAssetReaderDecoder::new_nv12(path.clone(), runtime.handle().clone()).unwrap();
        let repeated_elapsed = started.elapsed();
        assert!(Arc::ptr_eq(
            first.keyframe_index().unwrap(),
            second.keyframe_index().unwrap()
        ));
        let cache = Mutex::default();
        let started = std::time::Instant::now();
        let fresh = cached_nv12_index(&cache, &path, &|| false, || {
            KeyframeIndex::build_with_pixel_format(&path, Some(cv::PixelFormat::_420V))
        })
        .unwrap();
        let scan_elapsed = started.elapsed();
        let started = std::time::Instant::now();
        let reused = cached_nv12_index(&cache, &path, &|| false, || {
            panic!("Cached index must not read packets again")
        })
        .unwrap();
        let cache_elapsed = started.elapsed();
        assert!(Arc::ptr_eq(&fresh, &reused));
        assert_eq!(
            fresh.keyframes(),
            first.keyframe_index().unwrap().keyframes()
        );
        println!(
            "NV12 index cache benchmark: {}",
            serde_json::json!({
                "first_open_ms": first_elapsed.as_secs_f64() * 1000.0,
                "repeated_open_ms": repeated_elapsed.as_secs_f64() * 1000.0,
                "uncached_index_ms": scan_elapsed.as_secs_f64() * 1000.0,
                "cached_index_ms": cache_elapsed.as_secs_f64() * 1000.0,
                "keyframe_count": fresh.keyframe_count(),
            })
        );
        let requests = Cell::new(0);
        let cancelled = || {
            requests.set(requests.get() + 1);
            requests.get() > 20
        };
        assert!(
            KeyframeIndex::build_with_pixel_format_and_cancel(
                &path,
                Some(cv::PixelFormat::_420V),
                &cancelled,
            )
            .is_err()
        );
        assert_eq!(requests.get(), 21);
    }
}
