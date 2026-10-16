use serde::Serialize;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio::sync::Semaphore;

static PREPARING: std::sync::LazyLock<Arc<Semaphore>> =
    std::sync::LazyLock::new(|| Arc::new(Semaphore::new(2)));

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundMaterial {
    id: String,
    name: String,
    path: String,
    animated: bool,
}

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|v| v.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

pub(crate) fn is_system_material(path: &Path) -> bool {
    let value = path.to_string_lossy();
    [
        "/System/Library/Desktop Pictures/",
        "/System/Library/ExtensionKit/Extensions/",
        "/Library/Application Support/com.apple.idleassetsd/",
        "/Library/Desktop Pictures/",
    ]
    .iter()
    .any(|root| value.starts_with(root))
        || value.contains("/Library/Application Support/com.apple.wallpaper/")
        || value.contains("/Library/Application Support/com.apple.idleassetsd/")
        || (value.contains("/background-media-v1/")
            && path
                .file_name()
                .is_some_and(|name| name.to_string_lossy().starts_with("system-")))
}

fn scan(root: &Path, depth: usize, output: &mut Vec<PathBuf>) {
    if depth > 7 || output.len() >= 240 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    let mut entries = entries.filter_map(Result::ok).collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
        if name.contains("thumbnail") || name == ".thumbnails" {
            continue;
        }
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_dir() {
            scan(&path, depth + 1, output);
        } else if kind.is_file()
            && matches!(
                extension(&path).as_str(),
                "heic"
                    | "heif"
                    | "jpg"
                    | "jpeg"
                    | "png"
                    | "tif"
                    | "tiff"
                    | "webp"
                    | "mov"
                    | "mp4"
                    | "m4v"
            )
            && entry.metadata().is_ok_and(|meta| meta.len() > 128 * 1024)
            && !output.contains(&path)
        {
            output.push(path);
        }
        if output.len() >= 240 {
            break;
        }
    }
}

fn patterns(directory: &Path) -> Result<Vec<BackgroundMaterial>, String> {
    let presets = [
        (
            "obsidian-grid",
            "黑曜网格",
            [15u8, 15, 15],
            [61u8, 61, 61],
            0,
            0.0425,
        ),
        (
            "paper-grid",
            "工程白网格",
            [247, 247, 247],
            [201, 201, 201],
            0,
            0.04,
        ),
        (
            "midnight-dots",
            "暗夜星阵",
            [17, 17, 17],
            [194, 173, 138],
            1,
            0.032,
        ),
        (
            "paper-dots",
            "建筑极简点",
            [249, 249, 249],
            [160, 160, 160],
            1,
            0.03,
        ),
        (
            "isometric",
            "立体等角网",
            [19, 19, 19],
            [79, 74, 66],
            2,
            0.05,
        ),
        (
            "warm-grid",
            "暖砂网格",
            [245, 240, 228],
            [197, 183, 153],
            0,
            0.04,
        ),
    ];
    std::fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let mut output = Vec::new();
    for (id, name, background, ink, kind, fraction) in presets {
        let path = directory.join(format!("pattern-{id}.png"));
        if !path.is_file() {
            let tile = 1600.0f64 * fraction;
            let image = image::RgbImage::from_fn(2560, 1600, |x, y| {
                let x = f64::from(x);
                let y = f64::from(y);
                let line = |p: f64| {
                    let offset = p.rem_euclid(tile);
                    offset.min(tile - offset)
                };
                let distance = match kind {
                    1 => (line(x).powi(2) + line(y).powi(2)).sqrt() - 1.5,
                    2 => {
                        line(y)
                            .min(line(y * 0.5 + x * 0.8660254))
                            .min(line(y * 0.5 - x * 0.8660254))
                            - 0.35
                    }
                    _ => line(x).min(line(y)) - 0.4,
                };
                let alpha = (1.0 - distance).clamp(0.0, 1.0);
                image::Rgb(std::array::from_fn(|i| {
                    (f64::from(background[i])
                        + (f64::from(ink[i]) - f64::from(background[i])) * alpha)
                        as u8
                }))
            });
            let mut pending =
                tempfile::NamedTempFile::new_in(directory).map_err(|e| e.to_string())?;
            image
                .write_to(pending.as_file_mut(), image::ImageFormat::Png)
                .map_err(|e| e.to_string())?;
            let _ = pending.persist(&path).map_err(|e| e.to_string())?;
        }
        output.push(BackgroundMaterial {
            id: format!("pattern-{id}"),
            name: name.into(),
            path: path.to_string_lossy().into_owned(),
            animated: false,
        });
    }
    Ok(output)
}

#[tauri::command]
#[specta::specta]
pub async fn list_background_materials(app: AppHandle) -> Result<Vec<BackgroundMaterial>, String> {
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("background-materials-v1");
    tokio::task::spawn_blocking(move || {
        let mut output = patterns(&cache)?;
        let mut paths = Vec::new();
        #[cfg(target_os = "macos")]
        {
            for root in [
                "/System/Library/Desktop Pictures",
                "/Library/Desktop Pictures",
                "/Library/Application Support/com.apple.idleassetsd/Customer",
            ] {
                scan(Path::new(root), 0, &mut paths);
            }
            if let Some(home) = dirs::home_dir() {
                for root in [
                    "Library/Application Support/com.apple.wallpaper/aerials/videos",
                    "Library/Application Support/com.apple.idleassetsd/Customer",
                ] {
                    scan(&home.join(root), 0, &mut paths);
                }
            }
            if let Ok(entries) = std::fs::read_dir("/System/Library/ExtensionKit/Extensions") {
                for entry in entries
                    .filter_map(Result::ok)
                    .filter(|e| e.file_name().to_string_lossy().contains("Wallpaper"))
                {
                    scan(&entry.path().join("Contents/Resources"), 0, &mut paths);
                }
            }
        }
        let names = dirs::home_dir()
            .and_then(|home| {
                std::fs::read(home.join(
                    "Library/Application Support/com.apple.wallpaper/aerials/manifest/entries.json",
                ))
                .ok()
            })
            .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok());
        for path in paths {
            let stem = path.file_stem().unwrap_or_default().to_string_lossy();
            let label = names
                .as_ref()
                .and_then(|root| root.get("assets"))
                .and_then(serde_json::Value::as_array)
                .and_then(|assets| {
                    assets.iter().find(|asset| {
                        asset
                            .get("id")
                            .and_then(serde_json::Value::as_str)
                            .is_some_and(|id| id.eq_ignore_ascii_case(&stem))
                    })
                })
                .and_then(|asset| asset.get("accessibilityLabel"))
                .and_then(serde_json::Value::as_str);
            let fallback = if uuid::Uuid::parse_str(&stem).is_ok() {
                format!("本机屏保 · {}", &stem[..4])
            } else {
                stem.replace('_', " ")
            };
            let name = label.map(str::to_owned).unwrap_or(fallback);
            output.push(BackgroundMaterial {
                id: format!("local:{}", path.display()),
                name,
                animated: crate::desktop_wallpaper::is_video(&path),
                path: path.to_string_lossy().into_owned(),
            });
        }
        Ok(output)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
#[specta::specta]
pub async fn prepare_background_media(
    app: AppHandle,
    path: String,
    thumbnail: bool,
) -> Result<String, String> {
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("background-media-v1");
    let permit = PREPARING
        .clone()
        .acquire_owned()
        .await
        .map_err(|e| e.to_string())?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let source = PathBuf::from(path);
        let metadata = source.metadata().map_err(|e| e.to_string())?;
        if !metadata.is_file() {
            return Err("背景素材不是文件".into());
        }
        let convert = matches!(
            extension(&source).as_str(),
            "heic" | "heif" | "tif" | "tiff"
        );
        if !thumbnail && !convert {
            return Ok(source.to_string_lossy().into_owned());
        }
        let mut hash = DefaultHasher::new();
        source.hash(&mut hash);
        metadata.len().hash(&mut hash);
        metadata.modified().ok().hash(&mut hash);
        thumbnail.hash(&mut hash);
        std::fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
        let output = cache.join(format!(
            "{}{:x}.{}",
            if is_system_material(&source) {
                "system-"
            } else {
                ""
            },
            hash.finish(),
            if thumbnail { "jpg" } else { "png" }
        ));
        if !output.is_file() {
            if crate::desktop_wallpaper::is_video(&source) {
                crate::clip_thumbnails::decode_clip_thumbnail(&source, 0.0, &output)?;
            } else {
                #[cfg(target_os = "macos")]
                {
                    let mut command = std::process::Command::new("/usr/bin/sips");
                    command.args(["-s", "format", if thumbnail { "jpeg" } else { "png" }]);
                    if thumbnail {
                        command.args(["-Z", "480"]);
                    }
                    let result = command
                        .arg(&source)
                        .arg("--out")
                        .arg(&output)
                        .output()
                        .map_err(|e| e.to_string())?;
                    if !result.status.success() {
                        return Err(String::from_utf8_lossy(&result.stderr).into_owned());
                    }
                }
                #[cfg(not(target_os = "macos"))]
                {
                    image::open(&source)
                        .map_err(|e| e.to_string())?
                        .thumbnail(480, 480)
                        .save(&output)
                        .map_err(|e| e.to_string())?;
                }
            }
        }
        Ok(output.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_system_artwork_and_its_conversion_stay_external() {
        for path in [
            "/System/Library/Desktop Pictures/Sonoma.heic",
            "/Users/example/Library/Application Support/com.apple.wallpaper/aerials/videos/id.mov",
            "/Users/example/Library/Caches/com.jianku.screen.next/background-media-v1/system-a.png",
        ] {
            assert!(is_system_material(Path::new(path)));
        }
        assert!(!is_system_material(Path::new(
            "/Users/example/Pictures/system-photo.png"
        )));
        assert!(!is_system_material(Path::new(
            "/Users/example/Library/Caches/com.jianku.screen.next/background-materials-v1/pattern-paper-grid.png"
        )));
    }
}
