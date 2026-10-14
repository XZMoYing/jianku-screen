use super::*;
use std::collections::HashSet;

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MobileProject {
    pub path: PathBuf,
    pub name: String,
    pub phase: MobilePhase,
    pub has_source: bool,
}

#[derive(Deserialize)]
struct MobileSource {
    source: String,
}

fn read_mobile_source(project: &Path) -> Result<String, String> {
    let bytes = std::fs::read(project.join("mobile-source.json"))
        .map_err(|error| format!("无法读取设备录制信息：{error}"))?;
    let manifest: MobileSource =
        serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
    if !["content/mobile/source.mp4", "content/mobile/source.mov"]
        .contains(&manifest.source.as_str())
    {
        return Err("设备录制信息中的媒体路径不受支持，原文件未修改。".into());
    }
    if project.join(&manifest.source).exists() {
        let source = project
            .join(&manifest.source)
            .canonicalize()
            .map_err(|error| error.to_string())?;
        if !source.starts_with(project) || !source.is_file() {
            return Err("设备媒体不在这个工程内，原文件未修改。".into());
        }
    }
    Ok(manifest.source)
}

fn scan_mobile_projects(roots: &[PathBuf], active: Option<&Path>) -> Vec<MobileProject> {
    let mut seen = HashSet::new();
    let mut projects = Vec::new();
    for root in roots {
        let Ok(entries) = std::fs::read_dir(root) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !cap_project::is_project_path(&path) || !path.is_dir() {
                continue;
            }
            let Ok(path) = path.canonicalize() else {
                continue;
            };
            if !seen.insert(path.clone()) {
                continue;
            }
            let Ok(source) = read_mobile_source(&path) else {
                continue;
            };
            let Ok(meta) = RecordingMeta::load_for_project(&path) else {
                continue;
            };
            let RecordingMetaInner::Studio(studio) = meta.inner else {
                continue;
            };
            let phase = if active.is_some_and(|active| active == path) {
                MobilePhase::Recording
            } else if matches!(studio.status(), StudioRecordingStatus::Complete) {
                MobilePhase::Complete
            } else {
                MobilePhase::Failed
            };
            let modified = std::fs::metadata(path.join("recording-meta.json"))
                .and_then(|metadata| metadata.modified())
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
            projects.push((
                modified,
                MobileProject {
                    has_source: path.join(source).is_file(),
                    path,
                    name: meta.pretty_name,
                    phase,
                },
            ));
        }
    }
    projects.sort_by(|left, right| {
        right
            .0
            .cmp(&left.0)
            .then_with(|| left.1.path.cmp(&right.1.path))
    });
    projects.into_iter().map(|(_, project)| project).collect()
}

#[tauri::command]
#[specta::specta]
pub async fn list_mobile_projects(app: AppHandle) -> Result<Vec<MobileProject>, String> {
    let roots = crate::recordings_locations::known_recordings_dirs(&app);
    let status = get_mobile_status(app);
    let active = if status.active {
        status.project_path
    } else {
        None
    };
    let active = active.and_then(|path| path.canonicalize().ok());
    tokio::task::spawn_blocking(move || scan_mobile_projects(&roots, active.as_deref()))
        .await
        .map_err(|error| error.to_string())
}

fn recover_project_files(project: &Path) -> Result<String, String> {
    let source = read_mobile_source(project)?;
    let meta = RecordingMeta::load_for_project(project).map_err(|error| error.to_string())?;
    let RecordingMetaInner::Studio(studio) = &meta.inner else {
        return Err("请选择设备录制工程。".into());
    };
    if matches!(studio.status(), StudioRecordingStatus::Complete) {
        return Ok(source);
    }
    let StudioRecordingMeta::MultipleSegments { inner } = studio.as_ref() else {
        return Err("设备工程结构不受支持，原文件未修改。".into());
    };
    if inner.segments.len() != 1 || inner.segments[0].display.path.as_str() != source {
        return Err("这个工程已包含其他录制片段，无法自动恢复；原文件未修改。".into());
    }
    finalize_project(project, &source, &meta.pretty_name)?;
    Ok(source)
}

#[tauri::command]
#[specta::specta]
pub async fn recover_mobile_project(app: AppHandle, path: PathBuf) -> Result<PathBuf, String> {
    let capture_gate = app.state::<CaptureStartGate>();
    let _capture_guard = capture_gate.0.lock().await;
    let state = app.state::<MobileState>();
    let _guard = state.gate.lock().await;
    if active(&app)
        || crate::presentation::active(&app)
        || app
            .state::<crate::ArcLock<crate::App>>()
            .read()
            .await
            .is_recording_active_or_pending()
    {
        return Err("请先结束当前录制或演示，再恢复设备工程。".into());
    }
    if crate::EditorRecordingTarget::current(&app).is_some() {
        return Err("请先退出为已有工程录制片段的流程。".into());
    }
    let project = crate::FinalizationProject::admit(path).await?;
    let path = project.display_path().to_path_buf();
    let token = app
        .state::<crate::FinalizingRecordings>()
        .start_recovering(project)?;
    *state.status.lock().unwrap() = MobileStatus {
        phase: MobilePhase::Finalizing,
        active: true,
        project_path: Some(path.clone()),
        notice: Some("正在检查已保存的画面，原始视频和已有编辑会保留。".into()),
        ..Default::default()
    };
    let _ = app.emit("mobile-recording-active", true);
    let result =
        crate::run_finalization_worker(token, |project| recover_project_files(project.work_path()))
            .await;
    let notice = if let Ok(source) = &result {
        let _ = app.emit("recording-recovery-completed", &path);
        let open_notice = publish_saved_project(&app, &path, source).await;
        Some(open_notice.unwrap_or_else(|| "工程已恢复，请在编辑器检查录制结尾。".into()))
    } else {
        None
    };
    *state.status.lock().unwrap() = MobileStatus {
        phase: if result.is_ok() {
            MobilePhase::Complete
        } else {
            MobilePhase::Failed
        },
        active: false,
        project_path: Some(path.clone()),
        error: result.as_ref().err().cloned(),
        notice,
        ..Default::default()
    };
    let _ = app.emit("mobile-recording-active", false);
    result.map(|_| path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_project(root: &Path, name: &str, status: StudioRecordingStatus) -> PathBuf {
        let path = root.join(format!("{name}.jks"));
        std::fs::create_dir_all(path.join("content/mobile")).unwrap();
        std::fs::write(
            path.join("mobile-source.json"),
            br#"{"source":"content/mobile/source.mp4"}"#,
        )
        .unwrap();
        project_meta(&path, "content/mobile/source.mp4", name, 60, false, status)
            .save_for_project()
            .unwrap();
        path.canonicalize().unwrap()
    }

    #[test]
    fn recent_projects_survive_restart_and_old_in_progress_becomes_recoverable() {
        let root = tempfile::tempdir().unwrap();
        let pending = make_project(root.path(), "pending", StudioRecordingStatus::InProgress);
        std::fs::write(pending.join("content/mobile/source.mp4"), b"preserved").unwrap();
        make_project(root.path(), "complete", StudioRecordingStatus::Complete);
        make_project(
            root.path(),
            "failed",
            StudioRecordingStatus::Failed {
                error: "unplugged".into(),
            },
        );
        let roots = vec![root.path().into(), root.path().into()];
        let during = scan_mobile_projects(&roots, Some(&pending));
        assert_eq!(during.len(), 3);
        assert!(
            during
                .iter()
                .any(|item| item.path == pending && item.phase == MobilePhase::Recording)
        );
        let after = scan_mobile_projects(&roots, None);
        assert_eq!(after.len(), 3);
        assert!(after.iter().any(|item| item.path == pending
            && item.phase == MobilePhase::Failed
            && item.has_source));
        assert!(
            after
                .iter()
                .any(|item| item.name == "complete" && item.phase == MobilePhase::Complete)
        );
        assert!(
            after
                .iter()
                .any(|item| item.name == "failed" && !item.has_source)
        );
    }

    #[test]
    fn invalid_media_and_manifest_are_preserved_on_failed_recovery() {
        let root = tempfile::tempdir().unwrap();
        let path = make_project(root.path(), "broken", StudioRecordingStatus::InProgress);
        let source = path.join("content/mobile/source.mp4");
        std::fs::write(&source, b"incomplete container").unwrap();
        let meta = std::fs::read(path.join("recording-meta.json")).unwrap();
        assert!(recover_project_files(&path).is_err());
        assert_eq!(std::fs::read(&source).unwrap(), b"incomplete container");
        assert_eq!(
            std::fs::read(path.join("recording-meta.json")).unwrap(),
            meta
        );
        std::fs::write(
            path.join("mobile-source.json"),
            br#"{"source":"../outside.mp4"}"#,
        )
        .unwrap();
        assert!(recover_project_files(&path).is_err());
        assert_eq!(
            std::fs::read(path.join("recording-meta.json")).unwrap(),
            meta
        );
    }

    #[test]
    fn recovery_keeps_existing_edits_title_and_original_video() {
        let root = tempfile::tempdir().unwrap();
        let path = make_project(
            root.path(),
            "Edited title",
            StudioRecordingStatus::Failed {
                error: "save timeout".into(),
            },
        );
        let raw = path.join("content/mobile/source.mp4");
        let result =
            std::process::Command::new(tool("ffmpeg").expect("media fixture requires ffmpeg"))
                .args([
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "testsrc2=size=360x640:rate=30",
                    "-t",
                    "0.6",
                    "-c:v",
                    "h264_videotoolbox",
                    "-y",
                ])
                .arg(&raw)
                .status()
                .unwrap();
        assert!(result.success());
        let original = std::fs::read(&raw).unwrap();
        let mut config = crate::recording::default_project_config();
        config.background.padding = 17.0;
        config.background.frame = None;
        let mut value = serde_json::to_value(config).unwrap();
        value["retainedExtensionField"] = serde_json::json!({"marker": "existing edit"});
        let config_bytes = serde_json::to_vec_pretty(&value).unwrap();
        std::fs::write(path.join("project-config.json"), &config_bytes).unwrap();
        let warning = finalize_capture(
            &path,
            "content/mobile/source.mp4",
            "Must not replace title",
            Err("USB capture interrupted".into()),
        )
        .unwrap();
        assert!(warning.unwrap().contains("已保存"));
        assert_eq!(std::fs::read(&raw).unwrap(), original);
        assert_eq!(
            std::fs::read(path.join("project-config.json")).unwrap(),
            config_bytes
        );
        let meta = RecordingMeta::load_for_project(&path).unwrap();
        assert_eq!(meta.pretty_name, "Edited title");
        assert!(
            matches!(meta.inner, RecordingMetaInner::Studio(ref studio) if matches!(studio.status(), StudioRecordingStatus::Complete))
        );
        project_meta(
            &path,
            "content/mobile/source.mp4",
            "Edited title",
            60,
            false,
            StudioRecordingStatus::InProgress,
        )
        .save_for_project()
        .unwrap();
        recover_project_files(&path).unwrap();
        let complete_meta = std::fs::read(path.join("recording-meta.json")).unwrap();
        recover_project_files(&path).unwrap();
        assert_eq!(
            std::fs::read(path.join("recording-meta.json")).unwrap(),
            complete_meta
        );
        assert_eq!(
            std::fs::read(path.join("project-config.json")).unwrap(),
            config_bytes
        );
        assert_eq!(std::fs::read(&raw).unwrap(), original);
    }

    #[test]
    fn recovery_does_not_replace_unreadable_existing_edit_settings() {
        let root = tempfile::tempdir().unwrap();
        let path = make_project(
            root.path(),
            "broken settings",
            StudioRecordingStatus::InProgress,
        );
        let raw = path.join("content/mobile/source.mp4");
        let result =
            std::process::Command::new(tool("ffmpeg").expect("media fixture requires ffmpeg"))
                .args([
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=size=64x64:rate=30",
                    "-t",
                    "0.1",
                    "-c:v",
                    "h264_videotoolbox",
                    "-y",
                ])
                .arg(&raw)
                .status()
                .unwrap();
        assert!(result.success());
        std::fs::write(
            path.join("project-config.json"),
            b"interrupted existing settings",
        )
        .unwrap();
        let meta = std::fs::read(path.join("recording-meta.json")).unwrap();
        assert!(
            recover_project_files(&path)
                .unwrap_err()
                .contains("已有编辑设置")
        );
        assert_eq!(
            std::fs::read(path.join("project-config.json")).unwrap(),
            b"interrupted existing settings"
        );
        assert_eq!(
            std::fs::read(path.join("recording-meta.json")).unwrap(),
            meta
        );
    }

    #[cfg(unix)]
    #[test]
    fn recovery_rejects_source_symlink_outside_the_project() {
        let root = tempfile::tempdir().unwrap();
        let path = make_project(root.path(), "linked", StudioRecordingStatus::InProgress);
        let outside = root.path().join("outside.mp4");
        std::fs::write(&outside, b"outside original").unwrap();
        std::os::unix::fs::symlink(&outside, path.join("content/mobile/source.mp4")).unwrap();
        assert!(recover_project_files(&path).is_err());
        assert_eq!(std::fs::read(outside).unwrap(), b"outside original");
    }
}
