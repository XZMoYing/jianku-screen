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
    let trimmed = name.trim_end_matches(std::path::is_separator);
    if is_project_path(Path::new(trimmed)) {
        &trimmed[..trimmed.len() - 4]
    } else {
        name
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_package_suffix_after_native_trailing_separators() {
        for (input, expected) in [
            ("/tmp/演示.jks/", "/tmp/演示"),
            ("/tmp/take.CAP//", "/tmp/take"),
            ("take.JKS///", "take"),
            ("take.mp4/", "take.mp4/"),
            ("legacy.jianku/", "legacy.jianku/"),
        ] {
            assert_eq!(project_name_without_extension(input), expected);
        }
    }

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
