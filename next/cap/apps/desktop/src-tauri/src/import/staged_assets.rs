use std::{
    fs, io,
    path::{Path, PathBuf},
};

use tempfile::TempDir;

pub(super) struct StagedImportAssets {
    project: PathBuf,
    directories: Vec<TempDir>,
}

impl StagedImportAssets {
    pub(super) fn new(project: PathBuf) -> Self {
        Self {
            project,
            directories: Vec::new(),
        }
    }

    pub(super) fn reserve_segment(&mut self, index: u32) -> io::Result<String> {
        self.reserve("segments", &format!("segment-{index}-import-"))
    }

    pub(super) fn reserve_cursors(&mut self) -> io::Result<String> {
        self.reserve("cursors", "import-")
    }

    fn reserve(&mut self, kind: &str, prefix: &str) -> io::Result<String> {
        let content = self.project.join("content");
        let parent = content.join(kind);
        ensure_plain_directory(&content)?;
        ensure_plain_directory(&parent)?;

        let directory = tempfile::Builder::new()
            .prefix(prefix)
            .tempdir_in(&parent)?;
        let name = directory
            .path()
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| io::Error::other("Invalid import directory name"))?;
        let relative_path = format!("content/{kind}/{name}");
        self.directories.push(directory);
        Ok(relative_path)
    }

    pub(super) fn retain(self) {
        for directory in self.directories {
            drop(directory.keep());
        }
    }
}

fn ensure_plain_directory(path: &Path) -> io::Result<()> {
    match fs::create_dir(path) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error),
    }

    let metadata = path.symlink_metadata()?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(io::Error::other("Import destination uses a reparse point"));
        }
    }
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(io::Error::other(
            "Import destination must be a regular directory",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_import_discards_only_its_own_segment_and_cursor_files() {
        let project = tempfile::tempdir().unwrap();
        let old = project.path().join("content/segments/segment-1");
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("display.mp4"), b"existing").unwrap();

        let mut pending = StagedImportAssets::new(project.path().to_path_buf());
        let segment = project.path().join(pending.reserve_segment(1).unwrap());
        let cursors = project.path().join(pending.reserve_cursors().unwrap());
        fs::write(segment.join("display.mp4"), b"partial").unwrap();
        fs::write(cursors.join("arrow.png"), b"partial").unwrap();

        let mut other = StagedImportAssets::new(project.path().to_path_buf());
        let other_segment = project.path().join(other.reserve_segment(1).unwrap());
        assert_ne!(segment, other_segment);
        fs::write(other_segment.join("display.mp4"), b"complete").unwrap();

        drop(pending);
        other.retain();

        assert!(!segment.exists());
        assert!(!cursors.exists());
        assert_eq!(fs::read(old.join("display.mp4")).unwrap(), b"existing");
        assert_eq!(
            fs::read(other_segment.join("display.mp4")).unwrap(),
            b"complete"
        );
    }

    #[cfg(unix)]
    #[test]
    fn import_does_not_write_to_a_linked_destination() {
        let project = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), project.path().join("content")).unwrap();
        let mut pending = StagedImportAssets::new(project.path().to_path_buf());

        assert!(pending.reserve_segment(1).is_err());
        assert!(outside.path().read_dir().unwrap().next().is_none());
    }
}
