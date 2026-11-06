use std::{
    fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
};

use serde::{Deserialize, Serialize};
use tempfile::NamedTempFile;

use crate::{ProjectConfiguration, RecordingMeta};

const METADATA: &str = "recording-meta.json";
const CONFIG: &str = "project-config.json";
const JOURNAL: &str = ".append-publication.json";
const STAGED_FILE_PREFIX: &str = ".append-document-";
static PROJECT_WRITES: Mutex<()> = Mutex::new(());

fn lock_writes() -> io::Result<MutexGuard<'static, ()>> {
    PROJECT_WRITES
        .lock()
        .map_err(|_| io::Error::other("Project write lock is unavailable"))
}

pub(crate) fn project_write_guard(project: &Path) -> io::Result<MutexGuard<'static, ()>> {
    let guard = lock_writes()?;
    ensure_no_pending_append(project)?;
    Ok(guard)
}

pub(crate) fn ensure_no_pending_append(project: &Path) -> io::Result<()> {
    match project.join(JOURNAL).symlink_metadata() {
        Ok(_) => Err(io::Error::other(
            "An interrupted append must be recovered before using this project",
        )),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

pub struct ProjectAppendSnapshot {
    project: PathBuf,
    before: Documents,
}

#[derive(Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Documents {
    metadata: String,
    config: Option<String>,
}

impl Documents {
    fn read(project: &Path) -> io::Result<Self> {
        let metadata = read_regular_file(&project.join(METADATA))?
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, METADATA))?;
        let config = read_regular_file(&project.join(CONFIG))?;
        Ok(Self { metadata, config })
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct AppendJournal {
    version: u32,
    before: Documents,
    after: Documents,
}

impl ProjectAppendSnapshot {
    pub fn read(project: &Path) -> io::Result<(Self, RecordingMeta, ProjectConfiguration)> {
        let _guard = project_write_guard(project)?;
        let before = Documents::read(project)?;
        let metadata = RecordingMeta::from_project_json(project, &before.metadata)?;
        let config = match before.config.as_deref() {
            Some(json) => ProjectConfiguration::parse_and_migrate(json)?.0,
            None => ProjectConfiguration::default(),
        };
        Ok((
            Self {
                project: project.to_path_buf(),
                before,
            },
            metadata,
            config,
        ))
    }

    pub fn commit(
        self,
        metadata: &RecordingMeta,
        config: &ProjectConfiguration,
        retain_assets: impl FnOnce(),
    ) -> io::Result<()> {
        self.commit_with(metadata, config, retain_assets, StagedFile::publish)
    }

    fn commit_with(
        self,
        metadata: &RecordingMeta,
        config: &ProjectConfiguration,
        retain_assets: impl FnOnce(),
        publish_config: impl FnOnce(StagedFile) -> io::Result<()>,
    ) -> io::Result<()> {
        let project = &self.project;
        let _guard = project_write_guard(project)?;
        if Documents::read(project)? != self.before {
            return Err(io::Error::other(
                "Project changed during import. Save any current edits and try again",
            ));
        }

        config.validate().map_err(io::Error::other)?;
        let next_metadata = serde_json::to_string_pretty(metadata)?;
        let next_config = serde_json::to_string_pretty(config)?;
        let new_metadata = StagedFile::prepare(&project.join(METADATA), &next_metadata)?;
        let new_config = StagedFile::prepare(&project.join(CONFIG), &next_config)?;
        let old_metadata = StagedFile::prepare(&project.join(METADATA), &self.before.metadata)?;
        let journal = AppendJournal {
            version: 1,
            before: self.before,
            after: Documents {
                metadata: next_metadata,
                config: Some(next_config),
            },
        };
        if journal.before == journal.after {
            return Err(io::Error::other("The append would not change the project"));
        }
        let mut receipt = tempfile::Builder::new()
            .prefix(STAGED_FILE_PREFIX)
            .tempfile_in(project)?;
        serde_json::to_writer(&mut receipt, &journal)?;
        receipt.as_file().sync_all()?;

        if Documents::read(project)? != journal.before {
            return Err(io::Error::other(
                "Project changed while preparing the append. Try again",
            ));
        }
        receipt
            .persist_noclobber(project.join(JOURNAL))
            .map_err(|error| error.error)?;

        let publication = sync_directory(project).and_then(|()| new_metadata.publish());
        if let Err(error) = publication {
            if let Err(cleanup) = finish_journal(project) {
                tracing::warn!(%cleanup, "Could not remove unpublished append journal");
            }
            return Err(error);
        }

        let publication = (|| {
            sync_directory(project)?;
            let current = Documents::read(project)?;
            if current.metadata != journal.after.metadata || current.config != journal.before.config
            {
                return Err(unexpected_documents());
            }
            publish_config(new_config)
        })();
        if let Err(error) = publication {
            let rollback = (|| {
                let current = Documents::read(project)?;
                if current.metadata != journal.after.metadata
                    || current.config != journal.before.config
                {
                    return Err(unexpected_documents());
                }
                old_metadata.publish()?;
                finish_journal(project)
            })();
            if let Err(rollback_error) = rollback {
                retain_assets();
                return Err(io::Error::other(format!(
                    "Append failed ({error}). Recovery is required ({rollback_error})"
                )));
            }
            return Err(error);
        }

        retain_assets();
        if let Err(error) = finish_journal(project) {
            tracing::warn!(%error, "Append committed but its journal could not be cleared");
        }
        Ok(())
    }
}

pub(crate) fn is_append_artifact(name: &std::ffi::OsStr) -> bool {
    name == JOURNAL
        || name
            .to_str()
            .is_some_and(|name| name.starts_with(STAGED_FILE_PREFIX))
}

pub fn recover_interrupted_project_append(project: &Path) -> io::Result<()> {
    match project.join(JOURNAL).symlink_metadata() {
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
        Ok(_) => {}
    }
    let _guard = lock_writes()?;
    let Some(contents) = read_regular_file(&project.join(JOURNAL))? else {
        return Ok(());
    };
    let journal: AppendJournal = serde_json::from_str(&contents)?;
    if journal.version != 1 || journal.after.config.is_none() {
        return Err(io::Error::other("Unsupported project append journal"));
    }
    let current = Documents::read(project)?;
    if current == journal.before || current == journal.after {
        return finish_journal(project);
    }
    if current.metadata == journal.after.metadata && current.config == journal.before.config {
        RecordingMeta::from_project_json(project, &journal.before.metadata)?;
        StagedFile::prepare(&project.join(METADATA), &journal.before.metadata)?.publish()?;
        return finish_journal(project);
    }
    Err(unexpected_documents())
}

fn unexpected_documents() -> io::Error {
    io::Error::other("Project files changed after the append was interrupted. Files were preserved")
}

fn read_regular_file(path: &Path) -> io::Result<Option<String>> {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x0020_0000);
    }
    let mut file = match options.open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    if !plain_file(&file.metadata()?) {
        return Err(io::Error::other("Project document must be a regular file"));
    }
    let mut contents = String::new();
    file.read_to_string(&mut contents)?;
    Ok(Some(contents))
}

fn plain_file(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x0400 != 0 {
            return false;
        }
    }
    metadata.is_file()
}

struct StagedFile {
    file: NamedTempFile,
    destination: PathBuf,
}

impl StagedFile {
    fn prepare(destination: &Path, contents: &str) -> io::Result<Self> {
        let parent = destination
            .parent()
            .ok_or_else(|| io::Error::other("Project document has no parent directory"))?;
        let existing_permissions = match destination.symlink_metadata() {
            Ok(metadata) if plain_file(&metadata) && !metadata.permissions().readonly() => {
                Some(metadata.permissions())
            }
            Ok(_) => {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "Project document must be a writable regular file",
                ));
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => None,
            Err(error) => return Err(error),
        };
        let mut file = tempfile::Builder::new()
            .prefix(STAGED_FILE_PREFIX)
            .tempfile_in(parent)?;
        if let Some(permissions) = existing_permissions {
            file.as_file().set_permissions(permissions)?;
        }
        file.write_all(contents.as_bytes())?;
        file.as_file().sync_all()?;
        Ok(Self {
            file,
            destination: destination.to_path_buf(),
        })
    }

    fn publish(self) -> io::Result<()> {
        let mut path = self.file.into_temp_path();
        fs::rename(&path, self.destination)?;
        path.disable_cleanup(true);
        Ok(())
    }
}

fn finish_journal(project: &Path) -> io::Result<()> {
    sync_directory(project)?;
    fs::remove_file(project.join(JOURNAL))?;
    sync_directory(project)
}

#[cfg(unix)]
fn sync_directory(project: &Path) -> io::Result<()> {
    fs::File::open(project)?.sync_all()
}

#[cfg(not(unix))]
fn sync_directory(_project: &Path) -> io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{RecordingMetaInner, StudioRecordingMeta};
    use std::cell::Cell;

    const BEFORE: &str = r#"{"pretty_name":"Original","segments":[{"display":{"path":"content/first.mp4","fps":30}}],"cursors":{},"status":{"status":"Complete"}}"#;

    fn fixture() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(METADATA), BEFORE).unwrap();
        dir
    }

    fn append(metadata: &mut RecordingMeta) {
        let RecordingMetaInner::Studio(studio) = &mut metadata.inner else {
            panic!("Expected studio recording");
        };
        let StudioRecordingMeta::MultipleSegments { inner } = studio.as_mut() else {
            panic!("Expected multiple segment metadata");
        };
        let mut segment = inner.segments[0].clone();
        segment.display.path = "content/imported.mp4".into();
        inner.segments.push(segment);
    }

    #[test]
    fn second_publish_failure_restores_exact_bytes_and_allows_retry() {
        let project = fixture();
        let path = project.path();
        let original_config = "{ \"background\": { \"padding\": 9 } }\n";
        fs::write(path.join(CONFIG), original_config).unwrap();
        let (snapshot, mut metadata, mut config) = ProjectAppendSnapshot::read(path).unwrap();
        append(&mut metadata);
        config.background.padding = 13.0;
        let retained = Cell::new(false);

        let error = snapshot
            .commit_with(
                &metadata,
                &config,
                || retained.set(true),
                |_| Err(io::Error::other("second publication failed")),
            )
            .unwrap_err();
        assert!(error.to_string().contains("second publication failed"));
        assert!(!retained.get());
        assert_eq!(fs::read_to_string(path.join(METADATA)).unwrap(), BEFORE);
        assert_eq!(
            fs::read_to_string(path.join(CONFIG)).unwrap(),
            original_config
        );
        assert!(!path.join(JOURNAL).exists());

        let (retry, _, _) = ProjectAppendSnapshot::read(path).unwrap();
        retry
            .commit(&metadata, &config, || retained.set(true))
            .unwrap();
        assert!(retained.get());
        assert_eq!(
            RecordingMeta::load_for_project(path)
                .unwrap()
                .studio_source_count(),
            Some(2)
        );
        assert_eq!(
            ProjectConfiguration::load(path).unwrap().background.padding,
            13.0
        );
    }

    #[test]
    fn interrupted_append_recovers_without_overwriting_unrelated_changes() {
        let project = fixture();
        let path = project.path();
        let (snapshot, mut metadata, config) = ProjectAppendSnapshot::read(path).unwrap();
        append(&mut metadata);
        let journal = AppendJournal {
            version: 1,
            before: snapshot.before,
            after: Documents {
                metadata: serde_json::to_string_pretty(&metadata).unwrap(),
                config: Some(serde_json::to_string_pretty(&config).unwrap()),
            },
        };
        fs::write(path.join(JOURNAL), serde_json::to_vec(&journal).unwrap()).unwrap();
        fs::write(path.join(METADATA), &journal.after.metadata).unwrap();
        assert!(RecordingMeta::load_for_project(path).is_err());
        assert!(config.write(path).is_err());

        let unrelated_config = "{\"background\":{\"padding\":42}}";
        fs::write(path.join(CONFIG), unrelated_config).unwrap();
        assert!(recover_interrupted_project_append(path).is_err());
        assert_eq!(
            fs::read_to_string(path.join(CONFIG)).unwrap(),
            unrelated_config
        );
        assert!(path.join(JOURNAL).exists());

        fs::remove_file(path.join(CONFIG)).unwrap();
        recover_interrupted_project_append(path).unwrap();
        assert_eq!(fs::read_to_string(path.join(METADATA)).unwrap(), BEFORE);
        assert!(!path.join(CONFIG).exists());
        assert!(!path.join(JOURNAL).exists());

        fs::write(path.join(JOURNAL), serde_json::to_vec(&journal).unwrap()).unwrap();
        fs::write(path.join(METADATA), &journal.after.metadata).unwrap();
        fs::write(path.join(CONFIG), journal.after.config.as_ref().unwrap()).unwrap();
        recover_interrupted_project_append(path).unwrap();
        assert_eq!(
            fs::read_to_string(path.join(METADATA)).unwrap(),
            journal.after.metadata
        );
        assert!(!path.join(JOURNAL).exists());
        assert!(config.write_for_source_count(path, Some(1)).is_err());
        RecordingMeta::set_project_pretty_name(path, "Renamed".into()).unwrap();
        assert_eq!(
            RecordingMeta::load_for_project(path)
                .unwrap()
                .studio_source_count(),
            Some(2)
        );
    }

    #[test]
    fn later_append_cannot_publish_over_a_changed_project() {
        let project = fixture();
        let path = project.path();
        let (snapshot, mut metadata, config) = ProjectAppendSnapshot::read(path).unwrap();
        let (later, _, _) = ProjectAppendSnapshot::read(path).unwrap();
        append(&mut metadata);
        snapshot.commit(&metadata, &config, || {}).unwrap();

        assert!(
            later
                .commit(&metadata, &config, || panic!("stale assets retained"))
                .is_err()
        );
        assert_eq!(
            RecordingMeta::load_for_project(path)
                .unwrap()
                .studio_source_count(),
            Some(2)
        );
    }
}
