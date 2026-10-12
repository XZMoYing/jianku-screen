use std::{fs, io::Write, path::PathBuf, sync::Mutex};

use cap_project::{RecordingMeta, RecordingMetaInner, StudioRecordingStatus};
use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::{editor_window::WindowEditorInstance, windows::ShowCapWindow};

static HISTORY_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LocalProject {
    path: PathBuf,
    name: String,
}

fn history_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("local-projects.json"))
        .map_err(|error| error.to_string())
}

fn read_history(path: &std::path::Path) -> Result<Vec<PathBuf>, String> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|error| error.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(error.to_string()),
    }
}

pub(crate) fn remember_project(app: &AppHandle, project: PathBuf) -> Result<(), String> {
    remember_project_at(&history_path(app)?, project)
}

fn remember_project_at(path: &std::path::Path, project: PathBuf) -> Result<(), String> {
    let _guard = HISTORY_LOCK.lock().map_err(|error| error.to_string())?;
    let mut history = read_history(path)?;
    history.retain(|known| known != &project);
    history.insert(0, project);
    history.truncate(20);
    let parent = path
        .parent()
        .ok_or_else(|| "Cannot locate the project history folder".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    temporary
        .write_all(&serde_json::to_vec(&history).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    temporary.persist(path).map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn history_keeps_twenty_unique_paths_with_reopened_project_first() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("nested/local-projects.json");
        for index in 0..25 {
            remember_project_at(&path, root.path().join(format!("{index}.cap"))).unwrap();
        }
        let reopened = root.path().join("12.cap");
        remember_project_at(&path, reopened.clone()).unwrap();
        let history = read_history(&path).unwrap();
        assert_eq!(history.len(), 20);
        assert_eq!(history[0], reopened);
        assert_eq!(history[1], root.path().join("24.cap"));
        assert_eq!(history.iter().filter(|item| **item == reopened).count(), 1);
        assert!(!history.contains(&root.path().join("4.cap")));
    }

    #[test]
    fn invalid_history_is_reported_without_overwriting_original_bytes() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("local-projects.json");
        assert!(read_history(&path).unwrap().is_empty());
        fs::write(&path, b"invalid interrupted JSON").unwrap();
        assert!(remember_project_at(&path, root.path().join("test.cap")).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"invalid interrupted JSON");
    }
}

#[tauri::command]
#[specta::specta]
pub async fn list_local_projects(app: AppHandle) -> Result<Vec<LocalProject>, String> {
    tokio::task::spawn_blocking(move || {
        let _guard = HISTORY_LOCK.lock().map_err(|error| error.to_string())?;
        Ok(read_history(&history_path(&app)?)?
            .into_iter()
            .filter_map(|path| {
                let meta = RecordingMeta::load_for_project(&path).ok()?;
                Some(LocalProject {
                    path,
                    name: meta.pretty_name,
                })
            })
            .collect())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
#[specta::specta]
pub async fn open_local_project(app: AppHandle, path: PathBuf) -> Result<(), String> {
    let path = path.canonicalize().map_err(|error| error.to_string())?;
    let meta = RecordingMeta::load_for_project(&path)
        .map_err(|error| format!("无法打开这个工程：{error}"))?;
    let RecordingMetaInner::Studio(studio) = &meta.inner else {
        return Err("请选择可编辑的录制工程（.cap）".into());
    };
    if !matches!(studio.status(), StudioRecordingStatus::Complete) {
        return Err("工程仍在录制或处理中，请完成处理后再打开".into());
    }
    ShowCapWindow::Editor {
        project_path: path.clone(),
    }
    .show(&app)
    .await
    .map_err(|error| error.to_string())?;
    if let Err(error) = remember_project(&app, path) {
        tracing::warn!(%error, "Project opened but could not be added to local history");
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn copy_editor_project(
    app: AppHandle,
    editor: WindowEditorInstance,
    destination: PathBuf,
) -> Result<PathBuf, String> {
    let source = editor.project_path.clone();
    let result = tokio::task::spawn_blocking(move || {
        cap_project::create_portable_project_copy(&source, &destination)
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())?;
    if let Err(error) = remember_project(&app, result.path.clone()) {
        tracing::warn!(%error, "Project copied but could not be added to local history");
    }
    Ok(result.path)
}

#[tauri::command]
#[specta::specta]
pub async fn pick_local_project(app: AppHandle) -> Result<Option<PathBuf>, String> {
    #[cfg(target_os = "macos")]
    {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        app.run_on_main_thread(move || {
            use objc2::MainThreadMarker;
            use objc2_app_kit::{NSModalResponseOK, NSOpenPanel};
            use objc2_foundation::NSString;
            let selected = MainThreadMarker::new().and_then(|marker| unsafe {
                let panel = NSOpenPanel::openPanel(marker);
                panel.setCanChooseDirectories(true);
                panel.setCanChooseFiles(true);
                panel.setAllowsMultipleSelection(false);
                panel.setTitle(Some(&NSString::from_str("打开录制工程")));
                panel.setMessage(Some(&NSString::from_str(
                    "选择 .cap 工程。工程可以显示为文件夹或文件包。",
                )));
                panel.setPrompt(Some(&NSString::from_str("打开工程")));
                (panel.runModal() == NSModalResponseOK)
                    .then(|| {
                        panel
                            .URL()
                            .and_then(|url| url.path())
                            .map(|path| PathBuf::from(path.to_string()))
                    })
                    .flatten()
            });
            let _ = sender.send(selected);
        })
        .map_err(|error| error.to_string())?;
        receiver.await.map_err(|error| error.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        use tauri_plugin_dialog::DialogExt;
        let (sender, receiver) = tokio::sync::oneshot::channel();
        app.dialog()
            .file()
            .set_title("打开 .cap 工程文件夹")
            .pick_folder(move |path| {
                let _ = sender.send(path.and_then(|path| path.into_path().ok()));
            });
        receiver.await.map_err(|error| error.to_string())
    }
}
