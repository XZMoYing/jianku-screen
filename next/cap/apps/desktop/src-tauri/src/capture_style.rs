use cap_project::ProjectConfiguration;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;

#[derive(Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStyle {
    pub config: ProjectConfiguration,
    #[serde(default)]
    pub desktop_wallpaper: bool,
}

fn appearance_only(mut config: ProjectConfiguration) -> ProjectConfiguration {
    config.timeline = None;
    config.clips.clear();
    config.annotations.clear();
    config.overlay_order.clear();
    config.captions = None;
    config.keyboard = None;
    config.background.crop = None;
    config
}

pub fn saved(app: &AppHandle) -> Result<Option<CaptureStyle>, String> {
    app.store("store")
        .map_err(|error| error.to_string())?
        .get("capture_style")
        .map(|value| {
            let mut style: CaptureStyle =
                serde_json::from_value(value).map_err(|error| error.to_string())?;
            style.config = appearance_only(style.config);
            style.config.validate().map_err(|error| error.to_string())?;
            Ok(style)
        })
        .transpose()
}

#[tauri::command]
#[specta::specta]
pub fn get_capture_style(app: AppHandle) -> Result<CaptureStyle, String> {
    if let Some(style) = saved(&app)? {
        return Ok(style);
    }
    let config = if let Some(preset) = crate::presets::PresetsStore::get_default_preset(&app)? {
        appearance_only(preset.config)
    } else {
        let mut config = crate::recording::default_project_config();
        config.background.source = cap_project::BackgroundSource::Gradient {
            from: [160, 144, 111],
            to: [241, 231, 206],
            angle: 135,
            noise_intensity: None,
            noise_scale: None,
            animated: None,
            animation_speed: None,
        };
        crate::recording::apply_studio_sound_default(&app, &mut config);
        config
    };
    Ok(CaptureStyle {
        config,
        desktop_wallpaper: false,
    })
}

#[tauri::command]
#[specta::specta]
pub fn set_capture_style(app: AppHandle, mut style: CaptureStyle) -> Result<(), String> {
    style.config = appearance_only(style.config);
    style.config.validate().map_err(|error| error.to_string())?;
    let store = app.store("store").map_err(|error| error.to_string())?;
    store.set(
        "capture_style",
        serde_json::to_value(style).map_err(|error| error.to_string())?,
    );
    store.save().map_err(|error| error.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn get_current_wallpaper_preview(app: AppHandle) -> Result<String, String> {
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?;
    let dir = cache.join("appearance");
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let output = dir.join(format!("wallpaper-{}.jpg", uuid::Uuid::new_v4()));
    let result = tokio::task::spawn_blocking(move || {
        crate::recording::write_current_wallpaper_preview(&output)?;
        Ok::<_, String>(output.to_string_lossy().into_owned())
    })
    .await
    .map_err(|error| error.to_string())?;
    result
}

pub async fn snapshot(
    app: &AppHandle,
    project: &Path,
    target: Option<&cap_recording::sources::screen_capture::ScreenCaptureTarget>,
    animated: bool,
) -> Result<(), String> {
    let Some(mut style) = saved(app)? else {
        return Ok(());
    };
    if style.desktop_wallpaper {
        let path = project.join("assets/capture-wallpaper.jpg");
        let display_id = target.and_then(|target| target.display().map(|d| d.id().to_string()));
        let path = tokio::task::spawn_blocking(move || {
            crate::recording::write_current_wallpaper_to(&path, display_id.as_deref())?;
            if animated
                && let Some(media) = crate::desktop_wallpaper::selected_media(display_id.as_deref())
                    .filter(|p| crate::desktop_wallpaper::is_video(p))
            {
                return Ok::<_, String>(media);
            }
            Ok::<_, String>(path)
        })
        .await
        .map_err(|error| error.to_string())??;
        style.config.background.source = cap_project::BackgroundSource::Wallpaper {
            path: Some(path.to_string_lossy().into_owned()),
        };
    } else if let cap_project::BackgroundSource::Image { path: Some(source) }
    | cap_project::BackgroundSource::Wallpaper { path: Some(source) } =
        &mut style.config.background.source
    {
        let source_path = PathBuf::from(&*source);
        if source_path.is_file() {
            let assets = project.join("assets");
            std::fs::create_dir_all(&assets).map_err(|error| error.to_string())?;
            let name = format!(
                "capture-background.{}",
                source_path
                    .extension()
                    .and_then(|v| v.to_str())
                    .unwrap_or("png")
            );
            let destination = assets.join(name);
            std::fs::copy(source_path, &destination).map_err(|error| error.to_string())?;
            *source = destination.to_string_lossy().into_owned();
        }
    }
    std::fs::write(
        project.join("capture-style.json"),
        serde_json::to_vec(&style.config).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

pub fn recording_config(
    app: &AppHandle,
    project: &Path,
) -> Result<Option<ProjectConfiguration>, String> {
    if let Some(config) = project_config(project)? {
        return Ok(Some(config));
    }
    Ok(crate::presets::PresetsStore::get_default_preset(app)?.map(|preset| preset.config))
}

pub fn project_config(project: &Path) -> Result<Option<ProjectConfiguration>, String> {
    let path: PathBuf = project.join("capture-style.json");
    if !path.exists() {
        return Ok(None);
    }
    let config: ProjectConfiguration =
        serde_json::from_slice(&std::fs::read(path).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    config.validate().map_err(|error| error.to_string())?;
    Ok(Some(config))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_style_preserves_visuals_without_copying_edits() {
        let mut config = crate::recording::default_project_config();
        config.background.padding = 24.0;
        config.cursor.size = 170;
        config.timeline = Some(
            serde_json::from_value(serde_json::json!({"segments": [], "zoomSegments": []}))
                .unwrap(),
        );
        let clean = appearance_only(config);
        assert!(clean.timeline.is_none());
        assert_eq!(clean.background.padding, 24.0);
        assert_eq!(clean.cursor.size, 170);
    }

    #[test]
    fn capture_snapshot_is_independent_of_later_settings() {
        let dir = tempfile::tempdir().unwrap();
        let mut config = crate::recording::default_project_config();
        config.background.padding = 18.0;
        std::fs::write(
            dir.path().join("capture-style.json"),
            serde_json::to_vec(&config).unwrap(),
        )
        .unwrap();
        config.background.padding = 30.0;
        assert_eq!(
            project_config(dir.path())
                .unwrap()
                .unwrap()
                .background
                .padding,
            18.0
        );
    }
}
