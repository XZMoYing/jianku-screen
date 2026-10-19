use crate::{RecordingMeta, StudioRecordingMeta, TimelineConfiguration};
use serde::{Deserialize, Serialize};
use std::{io::Write, path::Path};

const FILE_NAME: &str = "recording-bookmarks.json";

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RecordingBookmark {
    pub id: String,
    pub label: String,
    pub recording_segment: u32,
    pub time: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub observed_time: Option<f64>,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkLocation {
    pub bookmark: RecordingBookmark,
    pub positions: Vec<f64>,
}

pub fn load_recording_bookmarks(project: &Path) -> Result<Vec<RecordingBookmark>, String> {
    let path = project.join(FILE_NAME);
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.to_string()),
    };
    let bookmarks: Vec<RecordingBookmark> =
        serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
    validate(&bookmarks)?;
    Ok(bookmarks)
}

fn validate(bookmarks: &[RecordingBookmark]) -> Result<(), String> {
    let mut ids = std::collections::HashSet::new();
    if bookmarks.iter().any(|bookmark| {
        bookmark.id.is_empty()
            || !ids.insert(&bookmark.id)
            || !bookmark.time.is_finite()
            || bookmark.time < 0.0
            || bookmark
                .observed_time
                .is_some_and(|time| !time.is_finite() || time < 0.0)
            || bookmark.label.chars().count() > 120
    }) {
        return Err("书签数据无效，原文件已保留。".into());
    }
    Ok(())
}

pub fn align_recording_bookmarks_to_sources(
    bookmarks: &mut [RecordingBookmark],
    bounds: &[(f64, f64)],
) {
    for bookmark in bookmarks {
        let Some(&(offset, duration)) = bounds.get(bookmark.recording_segment as usize) else {
            continue;
        };
        if !offset.is_finite() || !duration.is_finite() || duration <= 0.0 {
            continue;
        }
        // Stop requests can outlive the final encoded frame. Use the complete
        // source bounds, never the edited cuts, and retain the observed time.
        let observed = bookmark.observed_time.unwrap_or(bookmark.time);
        let time = observed.clamp(
            offset.max(0.0),
            (offset + duration - 0.000001).max(offset.max(0.0)),
        );
        if time != bookmark.time {
            bookmark.observed_time.get_or_insert(bookmark.time);
            bookmark.time = time;
        }
    }
}

pub fn save_recording_bookmarks(
    project: &Path,
    bookmarks: &[RecordingBookmark],
) -> Result<(), String> {
    validate(bookmarks)?;
    let path = project.join(FILE_NAME);
    let permissions = match std::fs::symlink_metadata(&path) {
        Ok(meta) if !meta.is_file() || meta.permissions().readonly() => {
            return Err("书签文件不可写，原文件已保留。".into());
        }
        Ok(meta) => Some(meta.permissions()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.to_string()),
    };
    let bytes = serde_json::to_vec_pretty(bookmarks).map_err(|error| error.to_string())?;
    let mut temporary =
        tempfile::NamedTempFile::new_in(project).map_err(|error| error.to_string())?;
    if let Some(permissions) = permissions {
        temporary
            .as_file()
            .set_permissions(permissions)
            .map_err(|error| error.to_string())?;
    }
    temporary
        .write_all(&bytes)
        .map_err(|error| error.to_string())?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    temporary
        .persist(project.join(FILE_NAME))
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn bookmark_source_offset(meta: &RecordingMeta, index: u32) -> f64 {
    match meta.studio_meta() {
        Some(StudioRecordingMeta::MultipleSegments { inner }) => inner
            .segments
            .get(index as usize)
            .and_then(|segment| segment.latest_start_time())
            .unwrap_or(0.0),
        _ => 0.0,
    }
}

pub fn locate_recording_bookmarks(
    mut bookmarks: Vec<RecordingBookmark>,
    meta: &RecordingMeta,
    timeline: &TimelineConfiguration,
    source_durations: &[f64],
) -> Vec<BookmarkLocation> {
    let bounds = source_durations
        .iter()
        .enumerate()
        .map(|(index, duration)| (bookmark_source_offset(meta, index as u32), *duration))
        .collect::<Vec<_>>();
    align_recording_bookmarks_to_sources(&mut bookmarks, &bounds);
    let offsets = crate::caption_timing::clip_timeline_offsets(timeline);
    let holds = timeline.hold_windows();
    bookmarks
        .into_iter()
        .map(|bookmark| {
            let offset = bookmark_source_offset(meta, bookmark.recording_segment);
            let source_time = bookmark.time - offset;
            let positions = timeline
                .segments
                .iter()
                .enumerate()
                .filter_map(|(index, clip)| {
                    if clip.recording_clip != bookmark.recording_segment
                        || !clip.timescale.is_finite()
                        || clip.timescale <= 0.0
                        || source_time < clip.start
                        || source_time >= clip.end
                    {
                        return None;
                    }
                    let mut time = offsets[index] + (source_time - clip.start) / clip.timescale;
                    for (start, end) in &holds {
                        if time >= *start {
                            time += end - start;
                        }
                    }
                    Some(time)
                })
                .collect();
            BookmarkLocation {
                bookmark,
                positions,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::TimelineSegment;

    fn bookmark() -> RecordingBookmark {
        RecordingBookmark {
            id: "mark-1".into(),
            label: "重点".into(),
            recording_segment: 0,
            time: 4.5,
            observed_time: None,
        }
    }

    #[test]
    fn missing_old_projects_and_atomic_roundtrip() {
        let project = tempfile::tempdir().unwrap();
        assert!(load_recording_bookmarks(project.path()).unwrap().is_empty());
        save_recording_bookmarks(project.path(), &[bookmark()]).unwrap();
        assert_eq!(
            load_recording_bookmarks(project.path()).unwrap()[0].time,
            4.5
        );
        let before = std::fs::read(project.path().join(FILE_NAME)).unwrap();
        let mut invalid = bookmark();
        invalid.time = f64::NAN;
        assert!(save_recording_bookmarks(project.path(), &[invalid]).is_err());
        assert_eq!(
            std::fs::read(project.path().join(FILE_NAME)).unwrap(),
            before
        );
    }

    #[test]
    fn maps_cut_reordered_duplicated_and_sped_up_sources() {
        let meta: RecordingMeta = serde_json::from_str(r#"{"pretty_name":"test","segments":[{"display":{"path":"screen.mp4","fps":60,"start_time":0.5}}],"cursors":{}}"#).unwrap();
        let mut timeline: TimelineConfiguration =
            serde_json::from_str(r#"{"segments":[],"zoomSegments":[]}"#).unwrap();
        timeline.segments = vec![
            TimelineSegment {
                recording_clip: 0,
                start: 5.0,
                end: 8.0,
                timescale: 1.0,
                ..Default::default()
            },
            TimelineSegment {
                recording_clip: 0,
                start: 2.0,
                end: 5.0,
                timescale: 2.0,
                ..Default::default()
            },
            TimelineSegment {
                recording_clip: 0,
                start: 4.0,
                end: 5.0,
                timescale: 1.0,
                ..Default::default()
            },
        ];
        let located = locate_recording_bookmarks(vec![bookmark()], &meta, &timeline, &[8.0]);
        assert_eq!(located[0].positions, vec![4.0, 4.5]);
        timeline.transitions = vec![crate::ClipTransition {
            segment_index: 1,
            kind: crate::ClipTransitionType::CrossFade,
            duration: 0.5,
        }];
        timeline.text_segments =
            vec![serde_json::from_str(r#"{"start":1.0,"end":2.0,"layout":"fullscreen"}"#).unwrap()];
        let with_hold = locate_recording_bookmarks(vec![bookmark()], &meta, &timeline, &[8.0]);
        assert_eq!(with_hold[0].positions, vec![4.5, 5.0]);
        timeline.segments.clear();
        assert!(
            locate_recording_bookmarks(vec![bookmark()], &meta, &timeline, &[8.0])[0]
                .positions
                .is_empty()
        );
    }

    #[test]
    fn markers_at_the_stop_request_remain_inside_the_muxed_source() {
        let mut bookmarks = vec![bookmark()];
        align_recording_bookmarks_to_sources(&mut bookmarks, &[(0.016, 4.0)]);
        assert!(bookmarks[0].time - 0.016 < 4.0);
        assert_eq!(bookmarks[0].observed_time, Some(4.5));
        let time = bookmarks[0].time;
        align_recording_bookmarks_to_sources(&mut bookmarks, &[(0.016, 4.0)]);
        assert_eq!(bookmarks[0].time, time);
        align_recording_bookmarks_to_sources(&mut bookmarks, &[(0.016, 5.0)]);
        assert_eq!(bookmarks[0].time, 4.5);
    }
}
