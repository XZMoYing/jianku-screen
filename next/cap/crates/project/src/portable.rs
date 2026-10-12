use std::{
    collections::HashMap,
    fs, io,
    path::{Path, PathBuf},
};

use serde::Serialize;
use serde_json::Value;

use crate::{ProjectConfiguration, RecordingMeta, RecordingMetaInner, StudioRecordingStatus};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCopyReport {
    pub path: PathBuf,
    pub files: u64,
    pub bytes: u64,
    pub embedded_assets: u32,
}

pub fn resolve_project_asset_path(project: &Path, stored: &str) -> PathBuf {
    let clean = stored
        .replace("asset://localhost/", "/")
        .replace("asset://", "")
        .replace("localhost//", "/");
    project.join(clean)
}

pub fn create_portable_project_copy(
    source: &Path,
    destination: &Path,
) -> io::Result<ProjectCopyReport> {
    let source = source.canonicalize()?;
    let original_meta = fs::read(source.join("recording-meta.json"))?;
    let meta: RecordingMeta = serde_json::from_slice(&original_meta)?;
    let RecordingMetaInner::Studio(studio) = &meta.inner else {
        return Err(io::Error::other(
            "Only editable recording projects can be copied",
        ));
    };
    if !matches!(studio.status(), StudioRecordingStatus::Complete) {
        return Err(io::Error::other(
            "Wait for recording processing to finish before copying the project",
        ));
    }
    if !destination
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("cap"))
    {
        return Err(io::Error::other("The project name must end in .cap"));
    }
    let parent = destination
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or(Path::new("."))
        .canonicalize()?;
    if parent.starts_with(&source) {
        return Err(io::Error::other(
            "The copy cannot be saved inside the original project",
        ));
    }
    let destination = parent.join(
        destination
            .file_name()
            .ok_or_else(|| io::Error::other("Invalid project name"))?,
    );
    require_new_destination(&destination)?;
    let original_config = read_optional_file(&source.join("project-config.json"))?;
    let staging = tempfile::Builder::new()
        .prefix(".jianku-project-copy-")
        .tempdir_in(&parent)?;
    copy_tree(&source, staging.path())?;
    let mut assets = AssetCopier {
        source: source.clone(),
        staging: staging.path().to_path_buf(),
        external: HashMap::new(),
    };
    let mut metadata: Value = serde_json::from_slice(&original_meta)?;
    if let Some(segment) = metadata.get_mut("segment") {
        copy_segment_assets(segment, &mut assets)?;
    }
    if let Some(segments) = metadata.get_mut("segments").and_then(Value::as_array_mut) {
        for segment in segments {
            copy_segment_assets(segment, &mut assets)?;
        }
    }
    if let Some(cursors) = metadata.get_mut("cursors").and_then(Value::as_object_mut) {
        for cursor in cursors.values_mut() {
            if cursor.is_string() {
                assets.materialize(cursor)?;
            } else if let Some(path) = cursor.get_mut("imagePath") {
                assets.materialize(path)?;
            }
        }
    }
    let object = metadata
        .as_object_mut()
        .ok_or_else(|| io::Error::other("Invalid project metadata"))?;
    object.insert("sharing".into(), Value::Null);
    object.insert(
        "pretty_name".into(),
        Value::String(
            destination
                .file_stem()
                .and_then(|name| name.to_str())
                .unwrap_or(&meta.pretty_name)
                .to_owned(),
        ),
    );
    object.remove("upload");
    fs::write(
        staging.path().join("recording-meta.json"),
        serde_json::to_vec_pretty(&metadata)?,
    )?;
    if let Some(bytes) = &original_config {
        let mut config: Value = serde_json::from_slice(bytes)?;
        let typed: ProjectConfiguration = serde_json::from_value(config.clone())?;
        typed.validate().map_err(io::Error::other)?;
        copy_background_asset(config.get_mut("background"), &mut assets)?;
        if let Some(timeline) = config.get_mut("timeline") {
            for key in ["imageSegments", "audioSegments"] {
                if let Some(segments) = timeline.get_mut(key).and_then(Value::as_array_mut) {
                    for segment in segments {
                        if let Some(path) = segment.get_mut("path") {
                            assets.materialize(path)?;
                        }
                    }
                }
            }
            if let Some(styles) = timeline
                .get_mut("styleSegments")
                .and_then(Value::as_array_mut)
            {
                for style in styles {
                    copy_background_asset(
                        style
                            .get_mut("overrides")
                            .and_then(|overrides| overrides.get_mut("background")),
                        &mut assets,
                    )?;
                }
            }
        }
        fs::write(
            staging.path().join("project-config.json"),
            serde_json::to_vec_pretty(&config)?,
        )?;
    }
    if fs::read(source.join("recording-meta.json"))? != original_meta
        || read_optional_file(&source.join("project-config.json"))? != original_config
    {
        return Err(io::Error::other(
            "The project changed while it was being copied. Pause editing and try again",
        ));
    }
    let (files, bytes) = tree_totals(staging.path())?;
    let report = ProjectCopyReport {
        path: destination.clone(),
        files,
        bytes,
        embedded_assets: assets.external.len() as u32,
    };
    publish_directory(staging.path(), &destination)?;
    Ok(report)
}

fn read_optional_file(path: &Path) -> io::Result<Option<Vec<u8>>> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

fn require_new_destination(path: &Path) -> io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(_) => Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "This project already exists. Choose a new name; existing projects are never replaced",
        )),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn copy_segment_assets(segment: &mut Value, assets: &mut AssetCopier) -> io::Result<()> {
    for key in ["display", "camera", "audio", "mic", "system_audio"] {
        if let Some(path) = segment.get_mut(key).and_then(|track| track.get_mut("path")) {
            assets.materialize(path)?;
        }
    }
    for key in ["cursor", "keyboard"] {
        if let Some(path) = segment.get_mut(key) {
            assets.materialize(path)?;
        }
    }
    Ok(())
}

fn copy_background_asset(
    background: Option<&mut Value>,
    assets: &mut AssetCopier,
) -> io::Result<()> {
    if let Some(path) = background
        .and_then(|value| value.get_mut("source"))
        .and_then(|source| source.get_mut("path"))
    {
        assets.materialize(path)?;
    }
    Ok(())
}

struct AssetCopier {
    source: PathBuf,
    staging: PathBuf,
    external: HashMap<PathBuf, String>,
}

impl AssetCopier {
    fn materialize(&mut self, value: &mut Value) -> io::Result<()> {
        let Some(stored) = value.as_str().filter(|path| !path.is_empty()) else {
            return Ok(());
        };
        let path = resolve_project_asset_path(&self.source, &stored.replace('\\', "/"));
        let resolved = path.canonicalize().map_err(|error| {
            io::Error::new(
                error.kind(),
                format!(
                    "A project asset is unavailable: {} ({error})",
                    path.display()
                ),
            )
        })?;
        if !resolved.is_file() {
            return Err(io::Error::other(format!(
                "Project asset is not a file: {}",
                resolved.display()
            )));
        }
        let relative = if let Ok(relative) = resolved.strip_prefix(&self.source) {
            let target = self.staging.join(relative);
            if !target.is_file() {
                return Err(io::Error::other("An internal project asset was not copied"));
            }
            relative.to_string_lossy().replace('\\', "/")
        } else if let Some(relative) = self.external.get(&resolved) {
            relative.clone()
        } else {
            let file_name = resolved
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("asset");
            let relative = format!("assets/portable/{}/{file_name}", uuid::Uuid::new_v4());
            let target = self.staging.join(&relative);
            fs::create_dir_all(
                target
                    .parent()
                    .ok_or_else(|| io::Error::other("Invalid asset path"))?,
            )?;
            copy_file_checked(&resolved, &target)?;
            self.external.insert(resolved, relative.clone());
            relative
        };
        *value = Value::String(relative);
        Ok(())
    }
}

fn copy_file_checked(source: &Path, destination: &Path) -> io::Result<()> {
    let before = source.metadata()?;
    if !before.is_file() {
        return Err(io::Error::other("A project contains an unsupported file"));
    }
    let bytes = fs::copy(source, destination)?;
    let after = source.metadata()?;
    if bytes != before.len()
        || before.len() != after.len()
        || before.modified().ok() != after.modified().ok()
    {
        return Err(io::Error::other(
            "A project file changed while copying. Try again when recording and export have finished",
        ));
    }
    Ok(())
}

fn copy_tree(source: &Path, destination: &Path) -> io::Result<()> {
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            copy_tree(&entry.path(), &destination.join(entry.file_name()))?;
        } else if file_type.is_file() || (file_type.is_symlink() && entry.path().is_file()) {
            copy_file_checked(&entry.path(), &destination.join(entry.file_name()))?;
        } else {
            return Err(io::Error::other(
                "Project folders with directory links or special files cannot be copied",
            ));
        }
    }
    Ok(())
}

fn tree_totals(path: &Path) -> io::Result<(u64, u64)> {
    let mut totals = (0, 0);
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            let (files, bytes) = tree_totals(&entry.path())?;
            totals.0 += files;
            totals.1 += bytes;
        } else {
            totals.0 += 1;
            totals.1 += entry.metadata()?.len();
        }
    }
    Ok(totals)
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn publish_directory(source: &Path, destination: &Path) -> io::Result<()> {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};
    let source = CString::new(source.as_os_str().as_bytes())?;
    let destination = CString::new(destination.as_os_str().as_bytes())?;
    #[cfg(target_os = "macos")]
    let result = unsafe {
        libc::renameatx_np(
            libc::AT_FDCWD,
            source.as_ptr(),
            libc::AT_FDCWD,
            destination.as_ptr(),
            libc::RENAME_EXCL,
        )
    };
    #[cfg(target_os = "linux")]
    let result = unsafe {
        libc::renameat2(
            libc::AT_FDCWD,
            source.as_ptr(),
            libc::AT_FDCWD,
            destination.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn publish_directory(source: &Path, destination: &Path) -> io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture(root: &Path) -> PathBuf {
        let source = root.join("source.cap");
        fs::create_dir_all(source.join("content")).unwrap();
        fs::write(source.join("content/display.mp4"), b"synthetic video").unwrap();
        fs::write(
            source.join("content/cursor.json"),
            b"{\"moves\":[],\"clicks\":[]}",
        )
        .unwrap();
        fs::write(source.join("content/cursor.png"), b"synthetic cursor").unwrap();
        fs::write(source.join("recording-meta.json"), serde_json::to_vec(&json!({
            "pretty_name":"Test project", "segments":[{"display":{"path":"content/display.mp4","fps":30},"cursor":"content/cursor.json"}],
            "cursors":{"arrow":{"imagePath":"content/cursor.png","hotspot":{"x":0.1,"y":0.2}}},"status":{"status":"Complete"},
            "sharing":{"id":"old-share","link":"https://example.invalid"}, "futureField":{"retained":true}
        })).unwrap()).unwrap();
        ProjectConfiguration::default().write(&source).unwrap();
        source
    }

    #[test]
    fn copy_remains_usable_after_moving_and_removing_original_assets() {
        let root = tempfile::tempdir().unwrap();
        let source = fixture(root.path());
        let external = root.path().join("custom background.png");
        fs::write(&external, b"synthetic background").unwrap();
        let mut config: Value =
            serde_json::from_slice(&fs::read(source.join("project-config.json")).unwrap()).unwrap();
        config["background"]["source"] = json!({"type":"image","path":external});
        config["timeline"] = json!({"segments":[],"zoomSegments":[],"styleSegments":[{"overrides":{"background":{"source":{"type":"image","path":external}}}}],"imageSegments":[{"path":external}],"audioSegments":[{"path":external,"start":0.0,"end":1.0}]});
        config["futureField"] = json!({"retained":true});
        fs::write(
            source.join("project-config.json"),
            serde_json::to_vec(&config).unwrap(),
        )
        .unwrap();
        let original_meta = fs::read(source.join("recording-meta.json")).unwrap();
        let original_config = fs::read(source.join("project-config.json")).unwrap();
        let destination = root.path().join("copy.cap");
        let report = create_portable_project_copy(&source, &destination).unwrap();
        assert_eq!(report.embedded_assets, 1);
        assert_eq!(
            fs::read(source.join("recording-meta.json")).unwrap(),
            original_meta
        );
        assert_eq!(
            fs::read(source.join("project-config.json")).unwrap(),
            original_config
        );
        let moved = root.path().join("another-location.cap");
        fs::rename(destination, &moved).unwrap();
        fs::remove_dir_all(source).unwrap();
        fs::remove_file(external).unwrap();
        let config: Value =
            serde_json::from_slice(&fs::read(moved.join("project-config.json")).unwrap()).unwrap();
        let path = config["background"]["source"]["path"].as_str().unwrap();
        assert_eq!(
            fs::read(resolve_project_asset_path(&moved, path)).unwrap(),
            b"synthetic background"
        );
        for path in [
            "/timeline/imageSegments/0/path",
            "/timeline/audioSegments/0/path",
            "/timeline/styleSegments/0/overrides/background/source/path",
        ] {
            assert_eq!(
                config.pointer(path).unwrap().as_str().unwrap(),
                config["background"]["source"]["path"].as_str().unwrap()
            );
        }
        assert_eq!(config["futureField"]["retained"], true);
        let metadata: Value =
            serde_json::from_slice(&fs::read(moved.join("recording-meta.json")).unwrap()).unwrap();
        assert!(metadata["sharing"].is_null());
        assert_eq!(metadata["futureField"]["retained"], true);
        assert_eq!(
            fs::read(moved.join("content/display.mp4")).unwrap(),
            b"synthetic video"
        );
        RecordingMeta::load_for_project(&moved).unwrap();
    }

    #[test]
    fn missing_assets_leave_no_destination_or_staging_directory() {
        let root = tempfile::tempdir().unwrap();
        let source = fixture(root.path());
        let mut config = ProjectConfiguration::default();
        config.background.source = crate::BackgroundSource::Image {
            path: Some("missing.png".into()),
        };
        config.write(&source).unwrap();
        let original = fs::read(source.join("project-config.json")).unwrap();
        let destination = root.path().join("copy.cap");
        assert!(create_portable_project_copy(&source, &destination).is_err());
        assert!(!destination.exists());
        assert_eq!(
            fs::read(source.join("project-config.json")).unwrap(),
            original
        );
        assert!(!fs::read_dir(root.path()).unwrap().flatten().any(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with(".jianku-project-copy-")
        }));
    }

    #[test]
    fn existing_and_nested_destinations_are_preserved() {
        let root = tempfile::tempdir().unwrap();
        let source = fixture(root.path());
        let destination = root.path().join("copy.cap");
        fs::create_dir(&destination).unwrap();
        fs::write(destination.join("keep"), b"existing").unwrap();
        assert!(create_portable_project_copy(&source, &destination).is_err());
        assert_eq!(fs::read(destination.join("keep")).unwrap(), b"existing");
        assert!(create_portable_project_copy(&source, &source.join("nested.cap")).is_err());
        assert!(!source.join("nested.cap").exists());
    }

    #[test]
    fn unfinished_recordings_are_not_copied() {
        let root = tempfile::tempdir().unwrap();
        let source = fixture(root.path());
        let mut metadata: Value =
            serde_json::from_slice(&fs::read(source.join("recording-meta.json")).unwrap()).unwrap();
        for status in ["InProgress", "NeedsRemux", "Failed"] {
            metadata["status"] = json!({"status":status,"error":"synthetic failure"});
            let original = serde_json::to_vec(&metadata).unwrap();
            fs::write(source.join("recording-meta.json"), &original).unwrap();
            let destination = root.path().join("copy.cap");
            assert!(create_portable_project_copy(&source, &destination).is_err());
            assert!(!destination.exists());
            assert_eq!(
                fs::read(source.join("recording-meta.json")).unwrap(),
                original
            );
        }
    }

    #[test]
    fn external_recording_media_and_events_are_embedded_and_deduplicated() {
        let root = tempfile::tempdir().unwrap();
        let source = fixture(root.path());
        let video = root.path().join("external.mp4");
        let sound = root.path().join("external.wav");
        let events = root.path().join("events.json");
        let cursor = root.path().join("arrow.png");
        for path in [&video, &sound, &events, &cursor] {
            fs::write(path, path.file_name().unwrap().as_encoded_bytes()).unwrap();
        }
        let mut metadata: Value =
            serde_json::from_slice(&fs::read(source.join("recording-meta.json")).unwrap()).unwrap();
        metadata["segments"][0] = json!({
            "display":{"path":video,"fps":30}, "camera":{"path":video,"fps":30},
            "mic":{"path":sound}, "system_audio":{"path":sound}, "cursor":events,"keyboard":events
        });
        metadata["cursors"]["arrow"]["imagePath"] = json!(cursor);
        fs::write(
            source.join("recording-meta.json"),
            serde_json::to_vec(&metadata).unwrap(),
        )
        .unwrap();
        let destination = root.path().join("copy.cap");
        let report = create_portable_project_copy(&source, &destination).unwrap();
        assert_eq!(report.embedded_assets, 4);
        for path in [&video, &sound, &events, &cursor] {
            fs::remove_file(path).unwrap();
        }
        let copied: Value =
            serde_json::from_slice(&fs::read(destination.join("recording-meta.json")).unwrap())
                .unwrap();
        for pointer in [
            "/segments/0/display/path",
            "/segments/0/camera/path",
            "/segments/0/mic/path",
            "/segments/0/system_audio/path",
            "/segments/0/cursor",
            "/segments/0/keyboard",
            "/cursors/arrow/imagePath",
        ] {
            let stored = copied.pointer(pointer).unwrap().as_str().unwrap();
            assert!(!Path::new(stored).is_absolute());
            assert!(destination.join(stored).is_file());
        }
        assert_eq!(
            copied["segments"][0]["display"]["path"],
            copied["segments"][0]["camera"]["path"]
        );
        assert_eq!(
            copied["segments"][0]["mic"]["path"],
            copied["segments"][0]["system_audio"]["path"]
        );
        RecordingMeta::load_for_project(&destination).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn directory_links_cannot_create_recursive_copies() {
        let root = tempfile::tempdir().unwrap();
        let source = fixture(root.path());
        std::os::unix::fs::symlink(&source, source.join("cycle")).unwrap();
        let destination = root.path().join("copy.cap");
        assert!(create_portable_project_copy(&source, &destination).is_err());
        assert!(!destination.exists());
        assert!(source.join("content/display.mp4").is_file());
    }

    #[test]
    fn final_publication_cannot_replace_a_concurrent_empty_directory() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("staging");
        let target = root.path().join("existing.cap");
        fs::create_dir(&source).unwrap();
        fs::create_dir(&target).unwrap();
        fs::write(source.join("media"), b"new").unwrap();
        assert!(publish_directory(&source, &target).is_err());
        assert!(target.is_dir());
        assert!(!target.join("media").exists());
        assert_eq!(fs::read(source.join("media")).unwrap(), b"new");
    }
}
