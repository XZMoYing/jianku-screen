import json, sys
from pathlib import Path
area = Path(__file__).parent
app_data = Path.home() / "Library" / "Application Support" / "com.jianku.screen.next"
reports = app_data / "diagnostics"

def write(name, value):
    (area / f"{name}.json").write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")

mode = sys.argv[1]
if mode == "report-before":
    write("report-baseline", sorted(p.name for p in reports.glob("cap-diagnostic-*.json")))
elif mode == "report-check":
    baseline = set(json.loads((area / "report-baseline.json").read_text()))
    new = sorted(p for p in reports.glob("cap-diagnostic-*.json") if p.name not in baseline)
    assert len(new) == 1, "expected exactly one new diagnostic report"
    report = json.loads(new[0].read_text())
    settings = report.get("settings") or {}
    assert all(key not in settings for key in ("recordingsPath", "previousRecordingsPaths", "serverUrl", "instanceId"))
    assert "customRecordingsDirectory" in settings and "previousRecordingsDirectoryCount" in settings
    if report.get("storage"):
        assert report["storage"]["recordingsPath"] == "[omitted]"
    for index, d in enumerate(report.get("displays", []), 1):
        assert d["id"] == f"display-{index}" and d["name"] == f"Display {index}"
    for index, d in enumerate(report.get("cameras", []), 1):
        assert d["deviceId"] == f"camera-{index}" and d["displayName"] == f"Camera {index}" and d["modelId"] is None
    for index, d in enumerate(report.get("microphones", []), 1):
        assert d["name"] == f"Microphone {index}"
    for index, d in enumerate(report.get("audioOutputs", []), 1):
        assert d["name"] == f"Audio output {index}"
    for recording in report.get("recentRecordings", []):
        assert recording.get("error") in (None, "Recording metadata or capture error")
        for segment in recording.get("segments", []):
            assert not any(key in segment for key in ("displayDeviceId", "cameraDeviceId", "micDeviceId", "systemAudioDeviceId"))
    permissions = report.get("permissions") or {}
    sync = report.get("syncTest")
    if sync:
        assert all(k not in sync.get("diagnostics", {}) for k in ("project_path", "instant_project_path"))
        assert sync.get("verdict") in ("pass", "warn", "fail", "inconclusive")
    result = {
        "reportFile": new[0].name,
        "appVersion": report.get("appVersion"),
        "audioDeviceProbe": report.get("audioDeviceProbe"),
        "screenRecording": permissions.get("screenRecording"),
        "newLocalReport": True,
        "deviceLabelsAndStorageMinimized": True,
        "syncVerdict": sync.get("verdict") if sync else None,
        "numericSyncMeasurementPresent": bool(sync and any(isinstance((sync.get(k) or {}).get("median_offset_ms"), (int, float)) for k in ("recording", "instant"))),
        "syncErrorRecorded": bool(report.get("syncTestError")),
    }
    write("report-results", result)
    print(json.dumps(result, ensure_ascii=False))
else:
    raise ValueError(mode)
