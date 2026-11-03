use std::path::{Path, PathBuf};

use crate::{is_project_path, project_name_without_extension};

pub struct CaptionStoragePaths {
    directory: PathBuf,
    legacy: Vec<PathBuf>,
}

impl CaptionStoragePaths {
    pub fn directory(&self) -> &Path {
        &self.directory
    }

    pub fn json_for_read(&self) -> PathBuf {
        let primary = self.directory.join("captions.json");
        if primary.exists() {
            return primary;
        }
        self.legacy
            .iter()
            .map(|path| path.join("captions.json"))
            .find(|path| path.exists())
            .unwrap_or(primary)
    }
}

pub fn caption_storage_paths(app_data: &Path, video_id: &str) -> CaptionStoragePaths {
    let cache = app_data.join("captions");
    let path = Path::new(video_id);
    let normalized_legacy = cache.join(project_name_without_extension(video_id));
    let directory = if path.is_absolute() && is_project_path(path) {
        path.to_path_buf()
    } else {
        normalized_legacy.clone()
    };
    // Preserve the former raw suffix slice only for reading files already written there.
    let raw_legacy = if is_project_path(path) {
        video_id
            .get(..video_id.len().saturating_sub(4))
            .unwrap_or(video_id)
    } else {
        video_id
    };
    let mut legacy = Vec::new();
    let mut candidates = vec![cache.join(raw_legacy), normalized_legacy];
    if is_project_path(path) {
        let trimmed = video_id.trim_end_matches(std::path::is_separator);
        for removed in 1..=3 {
            if let Some(prefix) = trimmed.get(..trimmed.len().saturating_sub(removed)) {
                candidates.push(cache.join(prefix));
            }
        }
    }
    for candidate in candidates {
        if candidate != directory && !legacy.contains(&candidate) {
            legacy.push(candidate);
        }
    }
    CaptionStoragePaths { directory, legacy }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_packages_keep_captions_inside_the_project_with_or_without_trailing_separator() {
        let temp = tempfile::tempdir().unwrap();
        for name in ["演示.jks", "演示.JKS", "legacy.cap", "legacy.CAP"] {
            let project = temp.path().join(name);
            for suffix in ["", "/", "//"] {
                let video_id = format!("{}{suffix}", project.display());
                let paths = caption_storage_paths(&temp.path().join("app-data"), &video_id);
                assert_eq!(paths.directory(), project);
                assert_eq!(paths.json_for_read(), project.join("captions.json"));
            }
        }
    }

    #[test]
    fn identifier_cache_preserves_existing_names() {
        let base = Path::new("app-data");
        for (id, expected) in [
            ("uuid", "uuid"),
            ("uuid.jks", "uuid"),
            ("uuid.cap", "uuid"),
            ("chapter.mp4", "chapter.mp4"),
        ] {
            assert_eq!(
                caption_storage_paths(base, id).directory(),
                base.join("captions").join(expected)
            );
        }
    }

    #[test]
    fn reads_legacy_sibling_json_then_writes_new_data_to_the_project() {
        let temp = tempfile::tempdir().unwrap();
        let project = temp.path().join("演示.jks");
        std::fs::create_dir(&project).unwrap();
        let legacy = temp.path().join("演示.");
        std::fs::create_dir(&legacy).unwrap();
        std::fs::write(legacy.join("captions.json"), "old").unwrap();
        let paths = caption_storage_paths(temp.path(), &format!("{}/", project.display()));
        assert_eq!(
            std::fs::read_to_string(paths.json_for_read()).unwrap(),
            "old"
        );
        std::fs::write(paths.directory().join("captions.json"), "new").unwrap();
        assert_eq!(
            std::fs::read_to_string(paths.json_for_read()).unwrap(),
            "new"
        );
        assert_eq!(
            std::fs::read_to_string(legacy.join("captions.json")).unwrap(),
            "old"
        );
    }

    #[test]
    fn reads_legacy_path_without_separator_and_prioritizes_the_project_file_even_if_invalid() {
        let temp = tempfile::tempdir().unwrap();
        let project = temp.path().join("take.cap");
        let old = temp.path().join("take");
        std::fs::create_dir(&project).unwrap();
        std::fs::create_dir(&old).unwrap();
        std::fs::write(old.join("captions.json"), "legacy").unwrap();
        let paths = caption_storage_paths(temp.path(), project.to_str().unwrap());
        assert_eq!(paths.json_for_read(), old.join("captions.json"));
        std::fs::write(project.join("captions.json"), "invalid current data").unwrap();
        assert_eq!(paths.json_for_read(), project.join("captions.json"));
    }

    #[test]
    fn reads_known_legacy_suffix_fragments_regardless_of_current_url_separator() {
        let temp = tempfile::tempdir().unwrap();
        let project = temp.path().join("take.jks");
        std::fs::create_dir(&project).unwrap();
        for name in ["take", "take.", "take.j", "take.jk"] {
            let legacy = temp.path().join(name);
            std::fs::create_dir(&legacy).unwrap();
            std::fs::write(legacy.join("captions.json"), name).unwrap();
            for suffix in ["", "/", "//", "///"] {
                let paths =
                    caption_storage_paths(temp.path(), &format!("{}{suffix}", project.display()));
                assert_eq!(
                    std::fs::read_to_string(paths.json_for_read()).unwrap(),
                    name
                );
            }
            std::fs::remove_dir_all(&legacy).unwrap();
        }
    }

    #[test]
    fn projects_with_matching_names_in_different_folders_do_not_share_captions() {
        let temp = tempfile::tempdir().unwrap();
        let first = temp.path().join("one/demo.jks");
        let second = temp.path().join("two/demo.jks");
        let first = caption_storage_paths(temp.path(), first.to_str().unwrap());
        let second = caption_storage_paths(temp.path(), second.to_str().unwrap());
        assert_ne!(first.directory(), second.directory());
        assert_eq!(first.directory().file_name().unwrap(), "demo.jks");
    }
}
