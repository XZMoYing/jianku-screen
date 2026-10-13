use std::path::Path;

pub const PROJECT_EXTENSION: &str = "jks";

pub fn is_project_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case(PROJECT_EXTENSION)
                || extension.eq_ignore_ascii_case("cap")
        })
}

pub fn project_name_without_extension(name: &str) -> &str {
    if is_project_path(Path::new(name)) {
        &name[..name.len() - 4]
    } else {
        name
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_legacy_packages_and_new_packages_without_accepting_qt_schema() {
        for name in ["demo.jks", "demo.JKS", "legacy.cap", "legacy.CAP"] {
            assert!(is_project_path(Path::new(name)));
            assert!(!project_name_without_extension(name).contains('.'));
        }
        assert!(!is_project_path(Path::new("legacy.jianku")));
        assert_eq!(project_name_without_extension("chapter.mp4"), "chapter.mp4");
    }
}
