use serde_json::{Map, Value, json};

fn numeric_fields(value: &Value, keys: &[&str]) -> Map<String, Value> {
    keys.iter()
        .filter_map(|&key| {
            let field = value.get(key)?;
            (field.is_number() || field.is_null()).then(|| (key.to_string(), field.clone()))
        })
        .collect()
}

fn safe_measurement(measurement: &Value) -> Value {
    if !measurement.is_object() {
        return Value::Null;
    }

    let mut result = numeric_fields(
        measurement,
        &[
            "paired_events",
            "inlier_events",
            "median_offset_ms",
            "mad_ms",
            "drift_ms_per_min",
            "total_drift_ms",
            "span_secs",
            "min_offset_ms",
            "max_offset_ms",
        ],
    );

    if let Some(events) = measurement.get("events").and_then(Value::as_array) {
        let events = events
            .iter()
            .filter(|event| {
                event
                    .as_array()
                    .is_some_and(|pair| pair.len() == 2 && pair.iter().all(Value::is_number))
            })
            .cloned()
            .collect();
        result.insert("events".to_string(), Value::Array(events));
    }

    Value::Object(result)
}

pub(super) fn safe_failure_code(error: &str) -> &'static str {
    if error.starts_with("screen recording permission unavailable") {
        "screen_capture_permission"
    } else {
        "unclassified"
    }
}

pub(super) fn safe_sync_report(report: &Value) -> Option<Value> {
    let verdict = report.get("verdict")?.as_str()?;
    if !matches!(verdict, "pass" | "warn" | "fail" | "inconclusive") {
        return None;
    }
    let mode = report
        .get("mode")
        .and_then(Value::as_str)
        .filter(|mode| matches!(*mode, "studio" | "instant" | "both"));
    let recording = safe_measurement(&report["recording"]);
    let instant = safe_measurement(&report["instant"]);
    let measured = [&recording, &instant].into_iter().find_map(|value| {
        Some((
            value.get("median_offset_ms")?.as_f64()?,
            value.get("total_drift_ms")?.as_f64()?,
        ))
    });
    let summary = measured.map_or_else(
        || "No timing measurements were available".to_string(),
        |(offset, drift)| format!("Measured offset {offset:+.1} ms and drift {drift:+.1} ms"),
    );

    Some(json!({
        "verdict": verdict,
        "summary": summary,
        "mode": mode,
        "recording": recording,
        "microphone": safe_measurement(&report["microphone"]),
        "export": safe_measurement(&report["export"]),
        "instant": instant,
        "studio_error": report["studio_error"].is_string().then_some("Studio sync test failed"),
        "instant_error": report["instant_error"].is_string().then_some("Instant sync test failed"),
        "studio_error_code": report["studio_error"].as_str().map(safe_failure_code),
        "instant_error_code": report["instant_error"].as_str().map(safe_failure_code),
        "thresholds": numeric_fields(&report["thresholds"], &[
            "pass_offset_ms", "pass_total_drift_ms", "warn_offset_ms",
            "warn_total_drift_ms", "max_raw_export_delta_ms",
        ]),
        "diagnostics": numeric_fields(&report["diagnostics"], &[
            "beep_snr", "audio_output_latency_ms", "emission_skew_ms",
        ]),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discards_child_paths_and_text_but_keeps_sync_measurements() {
        let report = json!({
            "verdict": "warn",
            "mode": "both",
            "summary": "/Volumes/private-sentinel/failure",
            "studio_error": "Failed to load private-sentinel",
            "instant_error": "screen recording permission unavailable: private-sentinel",
            "recording": {
                "median_offset_ms": 37.2,
                "total_drift_ms": -1.5,
                "events": [[1.0, 37.2], [2.0, "private-sentinel"]],
                "private-sentinel": 42,
            },
            "thresholds": {"warn_offset_ms": 60.0, "path": "private-sentinel"},
            "diagnostics": {
                "audio_output_latency_ms": 18.0,
                "project_path": "D:\\private-sentinel\\recording.jks",
            },
        });
        let result = safe_sync_report(&report).unwrap();

        assert!(!result.to_string().contains("private-sentinel"));
        assert_eq!(result["verdict"], "warn");
        assert_eq!(result["mode"], "both");
        assert_eq!(result["recording"]["events"], json!([[1.0, 37.2]]));
        assert_eq!(result["recording"]["median_offset_ms"], 37.2);
        assert_eq!(result["diagnostics"]["audio_output_latency_ms"], 18.0);
        assert_eq!(result["studio_error"], "Studio sync test failed");
        assert_eq!(result["studio_error_code"], "unclassified");
        assert_eq!(result["instant_error_code"], "screen_capture_permission");
        assert_eq!(
            result["summary"],
            "Measured offset +37.2 ms and drift -1.5 ms"
        );
    }

    #[test]
    fn does_not_publish_an_unknown_verdict_as_a_successful_report() {
        assert!(safe_sync_report(&json!({"verdict": "/Volumes/private-sentinel"})).is_none());
    }
}
