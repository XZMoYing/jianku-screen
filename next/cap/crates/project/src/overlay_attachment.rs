use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Type, Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ClipAttachmentTiming {
    #[default]
    PreserveDuration,
    FollowClipSpeed,
}

#[derive(Type, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum OverlayAttachment {
    Timeline {
        id: String,
    },
    Clip {
        id: String,
        #[serde(rename = "clipId")]
        clip_id: String,
        #[serde(rename = "sourceTime")]
        source_time: f64,
        #[serde(default)]
        timing: ClipAttachmentTiming,
    },
}

#[cfg(test)]
mod tests {
    use crate::ProjectConfiguration;
    use serde_json::json;

    #[test]
    fn overlay_attachments_round_trip_without_inventing_legacy_links() {
        let dir = tempfile::tempdir().unwrap();
        let tracks = [
            ("zoomSegments", json!({"amount":1.5,"mode":"auto"})),
            ("sceneSegments", json!({})),
            (
                "maskSegments",
                json!({"maskType":"sensitive","center":{"x":0.5,"y":0.5},"size":{"x":0.25,"y":0.25}}),
            ),
            ("textSegments", json!({"content":"Label"})),
            ("audioSegments", json!({"path":"content/music.wav"})),
            ("styleSegments", json!({})),
            ("imageSegments", json!({"path":"content/image.png"})),
            ("camera3dSegments", json!({})),
        ];
        let mut timeline = json!({
            "segments":[
                {"id":"first-use","recordingSegment":0,"start":4,"end":7,"timescale":1},
                {"id":"second-use","recordingSegment":0,"start":4,"end":7,"timescale":1}
            ]
        });
        for (name, payload) in &tracks {
            let mut attached = payload.clone();
            attached["start"] = json!(3.25);
            attached["end"] = json!(4.25);
            let mut fixed = attached.clone();
            let legacy = attached.clone();
            attached["attachment"] = json!({
                "kind":"clip", "id":format!("attached-{name}"),
                "clipId":"second-use", "sourceTime":4.25
            });
            fixed["attachment"] = json!({"kind":"timeline","id":format!("fixed-{name}")});
            timeline[name] = json!([attached, fixed, legacy]);
        }

        for extension in ["jks", "cap"] {
            let path = dir.path().join(format!("attachments.{extension}"));
            std::fs::create_dir(&path).unwrap();
            let mut project: ProjectConfiguration =
                serde_json::from_value(json!({"timeline":timeline})).unwrap();
            project.timeline.as_mut().unwrap().segments.swap(0, 1);
            project.write(&path).unwrap();
            let reopened = ProjectConfiguration::load(&path).unwrap();
            let encoded = serde_json::to_value(reopened).unwrap();
            assert_eq!(encoded["timeline"]["segments"][0]["id"], "second-use");
            for (name, _) in &tracks {
                let rows = &encoded["timeline"][name];
                assert_eq!(
                    rows[0]["attachment"],
                    json!({
                        "kind":"clip", "id":format!("attached-{name}"), "clipId":"second-use",
                        "sourceTime":4.25, "timing":"preserveDuration"
                    })
                );
                assert_eq!(rows[0]["start"], 3.25);
                assert_eq!(rows[0]["end"], 4.25);
                assert_eq!(
                    rows[1]["attachment"],
                    json!({"kind":"timeline","id":format!("fixed-{name}")})
                );
                assert!(rows[2].get("attachment").is_none());
            }
        }
    }
}
