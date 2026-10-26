#[cfg(target_os = "macos")]
fn main() -> Result<(), String> {
    use cap_video_decode::AVAssetReaderDecoder;
    use cidre::cv::pixel_buffer::LockFlags;
    use serde_json::json;
    use sha2::{Digest, Sha256};
    use std::{path::PathBuf, time::Instant};

    fn sample(
        decoder: &mut AVAssetReaderDecoder,
        target: f64,
    ) -> Result<(f64, String, usize), String> {
        let mut count = 0;
        let mut selected = None;
        for frame in decoder.frames() {
            let frame = frame.map_err(|error| error.to_string())?;
            let done = frame.pts().as_secs() + 0.0001 >= target;
            selected = Some(frame);
            count += 1;
            if done {
                break;
            }
        }
        let frame = selected.ok_or("Reader returned no frame")?;
        let mut image = frame.image_buf().ok_or("Missing sample image")?.retained();
        unsafe {
            image
                .lock_base_addr(LockFlags::READ_ONLY)
                .result()
                .map_err(|error| format!("Lock failed: {error:?}"))?;
        }
        let mut digest = Sha256::new();
        for plane in 0..image.plane_count() {
            let stride = image.plane_bytes_per_row(plane);
            let height = image.plane_height(plane);
            let data = unsafe {
                std::slice::from_raw_parts(image.plane_base_address(plane), stride * height)
            };
            for row in data.chunks_exact(stride) {
                digest.update(&row[..image.width()]);
            }
        }
        unsafe { image.unlock_lock_base_addr(LockFlags::READ_ONLY) };
        Ok((
            frame.pts().as_secs(),
            format!("{:x}", digest.finalize()),
            count,
        ))
    }

    ffmpeg::init().map_err(|error| error.to_string())?;
    let runtime = tokio::runtime::Runtime::new().map_err(|error| error.to_string())?;
    let mut results = Vec::new();
    for argument in std::env::args().skip(1) {
        let path = PathBuf::from(argument)
            .canonicalize()
            .map_err(|error| error.to_string())?;
        let mut baseline = AVAssetReaderDecoder::new_nv12(path.clone(), runtime.handle().clone())?;
        let mut indexed = AVAssetReaderDecoder::new_nv12(path.clone(), runtime.handle().clone())?;
        let duration = indexed
            .keyframe_index()
            .ok_or("Missing index")?
            .duration_secs();
        for target in [
            0.0,
            0.00001,
            1.0 / 60.0,
            0.29995,
            0.3,
            0.30005,
            1.017,
            duration - 0.5,
            duration - 0.00001,
            0.3,
            0.0,
        ] {
            let began = Instant::now();
            baseline.reset(target as f32)?;
            let expected = sample(&mut baseline, target)?;
            let baseline_ms = began.elapsed().as_secs_f64() * 1000.0;
            let began = Instant::now();
            indexed.reset_for_precise_sample(target)?;
            let actual = sample(&mut indexed, target)?;
            let indexed_ms = began.elapsed().as_secs_f64() * 1000.0;
            if expected.0 != actual.0 || expected.1 != actual.1 {
                return Err(format!(
                    "Sample differs: {} target={target}, expected={expected:?}, actual={actual:?}",
                    path.display()
                ));
            }
            results.push(json!({
                "path":path,"target":target,"pts":actual.0,"sha256":actual.1,
                "baselineSamples":expected.2,"indexedSamples":actual.2,
                "baselineMs":baseline_ms,"indexedMs":indexed_ms,
            }));
        }
    }
    if results.is_empty() {
        return Err("Pass one or more synthetic video paths".into());
    }
    println!(
        "{}",
        serde_json::to_string_pretty(&results).map_err(|error| error.to_string())?
    );
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("This probe requires macOS");
    std::process::exit(1);
}
