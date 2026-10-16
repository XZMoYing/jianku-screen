use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub(crate) fn is_video(path: &Path) -> bool {
    path.extension()
        .and_then(|v| v.to_str())
        .is_some_and(|v| matches!(v.to_ascii_lowercase().as_str(), "mov" | "mp4" | "m4v"))
}

#[cfg(target_os = "macos")]
fn strings(value: &plist::Value, output: &mut Vec<String>) {
    match value {
        plist::Value::String(value) => output.push(value.clone()),
        plist::Value::Array(values) => values.iter().for_each(|value| strings(value, output)),
        plist::Value::Dictionary(values) => {
            values.values().for_each(|value| strings(value, output))
        }
        plist::Value::Data(data) => {
            if let Ok(value) = plist::Value::from_reader(std::io::Cursor::new(data)) {
                strings(&value, output);
            }
        }
        _ => {}
    }
}

#[cfg(target_os = "macos")]
fn content(value: &plist::Value) -> Option<&plist::Value> {
    let dict = value.as_dictionary()?;
    if dict.contains_key("Choices") {
        return Some(value);
    }
    ["Desktop", "Linked", "Content"]
        .into_iter()
        .find_map(|key| dict.get(key).and_then(content))
}

#[cfg(target_os = "macos")]
fn display_uuid(display_id: Option<&str>) -> Option<String> {
    use core_foundation::{
        base::TCFType,
        string::CFString,
        uuid::{CFUUID, CFUUIDCreateString, CFUUIDRef},
    };
    unsafe extern "C" {
        fn CGDisplayCreateUUIDFromDisplayID(display: u32) -> CFUUIDRef;
    }
    let display = display_id
        .and_then(|id| id.parse().ok())
        .unwrap_or_else(|| core_graphics::display::CGDisplay::main().id);
    unsafe {
        let uuid = CGDisplayCreateUUIDFromDisplayID(display);
        if uuid.is_null() {
            return None;
        }
        let uuid = CFUUID::wrap_under_create_rule(uuid);
        let string = CFString::wrap_under_create_rule(CFUUIDCreateString(
            std::ptr::null(),
            uuid.as_concrete_TypeRef(),
        ));
        Some(string.to_string())
    }
}

#[cfg(target_os = "macos")]
fn selected_content<'a>(root: &'a plist::Value, display: Option<&str>) -> Option<&'a plist::Value> {
    let root = root.as_dictionary()?;
    if let Some(display) = display
        && let Some(value) = root
            .get("Displays")
            .and_then(plist::Value::as_dictionary)
            .and_then(|v| v.get(display))
            .and_then(content)
    {
        return Some(value);
    }
    if let Some(value) = root.get("AllSpacesAndDisplays").and_then(content) {
        return Some(value);
    }
    if root
        .get("Spaces")
        .and_then(plist::Value::as_dictionary)
        .is_some_and(|spaces| !spaces.is_empty())
    {
        return None;
    }
    root.get("SystemDefault").and_then(content)
}

#[cfg(target_os = "macos")]
pub(crate) fn selected_media(display_id: Option<&str>) -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let root = plist::Value::from_file(
        home.join("Library/Application Support/com.apple.wallpaper/Store/Index.plist"),
    )
    .ok()?;
    let choice = selected_content(&root, display_uuid(display_id).as_deref())?
        .as_dictionary()?
        .get("Choices")?
        .as_array()?
        .first()?;
    let mut values = Vec::new();
    strings(choice, &mut values);
    for value in &values {
        let path = if value.starts_with("file://") {
            reqwest::Url::parse(value).ok()?.to_file_path().ok()?
        } else if value.starts_with('/') {
            PathBuf::from(value)
        } else {
            continue;
        };
        if path.extension().is_some_and(|v| v == "madesktop") {
            if let Some(path) = plist::Value::from_file(path)
                .ok()
                .and_then(|v| {
                    v.as_dictionary()?
                        .get("thumbnailPath")?
                        .as_string()
                        .map(PathBuf::from)
                })
                .filter(|p| p.is_file())
            {
                return Some(path);
            }
        } else if path.is_file() {
            return Some(path);
        }
    }
    let roots = [
        home.join("Library/Application Support/com.apple.wallpaper/aerials/videos"),
        PathBuf::from("/Library/Application Support/com.apple.idleassetsd/Customer/4KSDR240FPS"),
        PathBuf::from("/Library/Application Support/com.apple.idleassetsd/Customer/4KSDR120FPS"),
        home.join("Library/Application Support/com.apple.idleassetsd/Customer/4KSDR240FPS"),
    ];
    for identifier in values.iter().filter(|v| uuid::Uuid::parse_str(v).is_ok()) {
        for root in &roots {
            for ext in ["mov", "mp4", "m4v"] {
                let path = root.join(format!("{identifier}.{ext}"));
                if path.is_file() {
                    return Some(path);
                }
            }
        }
    }
    None
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn selected_media(_display_id: Option<&str>) -> Option<PathBuf> {
    None
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DesktopWallpaper {
    pub path: String,
    pub preview_path: String,
    pub animated: bool,
}

#[tauri::command]
#[specta::specta]
pub async fn get_desktop_wallpaper(
    app: AppHandle,
    project_path: Option<String>,
) -> Result<DesktopWallpaper, String> {
    let directory = match project_path {
        Some(path) => PathBuf::from(path).join("assets"),
        None => app
            .path()
            .app_cache_dir()
            .map_err(|e| e.to_string())?
            .join("appearance"),
    };
    tokio::task::spawn_blocking(move || {
        std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let preview = directory.join(format!(
            "current-desktop-background-{}.jpg",
            uuid::Uuid::new_v4()
        ));
        crate::recording::write_current_wallpaper_preview(&preview)?;
        let media = selected_media(None).filter(|path| is_video(path));
        Ok(DesktopWallpaper {
            path: media
                .as_ref()
                .unwrap_or(&preview)
                .to_string_lossy()
                .into_owned(),
            preview_path: preview.to_string_lossy().into_owned(),
            animated: media.is_some(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    #[test]
    fn resolves_target_display_before_global_selection() {
        let value = |name: &str| {
            plist::Value::Dictionary(
                [(
                    "Content".to_string(),
                    plist::Value::Dictionary(
                        [(
                            "Choices".to_string(),
                            plist::Value::Array(vec![plist::Value::String(name.into())]),
                        )]
                        .into_iter()
                        .collect(),
                    ),
                )]
                .into_iter()
                .collect(),
            )
        };
        let root = plist::Value::Dictionary(
            [
                (
                    "Displays".to_string(),
                    plist::Value::Dictionary(
                        [("D1".to_string(), value("target"))].into_iter().collect(),
                    ),
                ),
                ("AllSpacesAndDisplays".to_string(), value("global")),
            ]
            .into_iter()
            .collect(),
        );
        let mut found = Vec::new();
        strings(selected_content(&root, Some("D1")).unwrap(), &mut found);
        assert_eq!(found, ["target"]);
        found.clear();
        strings(selected_content(&root, Some("D2")).unwrap(), &mut found);
        assert_eq!(found, ["global"]);
    }
    #[test]
    fn extracts_binary_provider_configuration() {
        let value = plist::Value::Dictionary(
            [(
                "assetID".to_string(),
                plist::Value::String("id".to_string()),
            )]
            .into_iter()
            .collect(),
        );
        let mut bytes = Vec::new();
        value.to_writer_binary(&mut bytes).unwrap();
        let mut found = Vec::new();
        strings(&plist::Value::Data(bytes), &mut found);
        assert_eq!(found, ["id"]);
    }
}
