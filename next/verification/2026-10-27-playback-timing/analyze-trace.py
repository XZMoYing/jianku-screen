import argparse
import gzip
import hashlib
import json
import math
from pathlib import Path
import statistics


def distribution(values):
    ordered = sorted(values)
    if not ordered or not all(math.isfinite(value) for value in ordered):
        raise ValueError("Expected finite non-empty samples")
    return {
        "count": len(ordered),
        "median": statistics.median(ordered),
        "p95": ordered[math.ceil(len(ordered) * 0.95) - 1],
        "p99": ordered[math.ceil(len(ordered) * 0.99) - 1],
        "max": ordered[-1],
    }


def analyze(path):
    raw = path.read_bytes()
    if path.suffix == ".gz":
        raw = gzip.decompress(raw)
    report = json.loads(raw)
    if not report["traceEnabled"]:
        raise ValueError(f"Trace was disabled: {path}")
    timings = report["timings"]
    metrics = {}
    for stage, fields in {
        "rendered": ["renderMs", "queueMs", "backgroundMs", "displayMs", "cameraMs",
                     "finishWaitMs", "submitReadbackMs", "immediateFlushMs", "callbackMs"],
        "submitted": ["overshootMs", "acquireMs", "uniformsMs", "submitMs"],
    }.items():
        points = [point for point in timings if point["stage"] == stage]
        for field in fields:
            metrics[field] = distribution([point[field] for point in points])
            metrics[field]["largest"] = [
                {"seconds": point["seconds"], "frame": point["frame"], "milliseconds": point[field]}
                for point in sorted(points, key=lambda point: point[field], reverse=True)[:3]
            ]
    audio = report["audio"]
    callback_lateness = [(point["callback_seconds"] - point["seconds"]) * 1000 for point in audio]
    return {
        "artifact": path.name,
        "uncompressedSha256": hashlib.sha256(raw).hexdigest(),
        "passed": report["passed"],
        "error": report["error"],
        "startupMs": report["startupMs"],
        "fps": report["fps"],
        "replayRounds": report["replayRounds"],
        "windowCount": len(report["windows"]),
        "sourcePhaseChecks": sum(window["source_checks"] for window in report["windows"]),
        "naturalEndVerified": report["naturalEndVerified"],
        "timingEvents": len(timings),
        "windows": report["windows"],
        "plannedAudioToNativeVideoOffsetMs": distribution([
            abs(offset) for window in report["windows"] for offset in window["audio_video_offsets_ms"]
        ]),
        "audioCallbackLatenessMs": distribution(callback_lateness),
        "metrics": metrics,
        "controlEvents": [point for point in timings if point["stage"] == "control"],
        "scope": report["scope"],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("reports", nargs="+", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    results = [analyze(path) for path in args.reports]
    with args.output.open("x") as output:
        json.dump(results, output, ensure_ascii=False, indent=2)
        output.write("\n")
    for result in results:
        print(result["artifact"], result["passed"], result["windowCount"],
              "windows", result["sourcePhaseChecks"], "phase checks",
              "max background ms", result["metrics"]["backgroundMs"]["max"],
              "max render/readback ms", result["metrics"]["renderMs"]["max"])


if __name__ == "__main__":
    main()
