import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument("directory", type=Path)
parser.add_argument("--ffmpeg", default=shutil.which("ffmpeg"))
parser.add_argument("--ffprobe", default=shutil.which("ffprobe"))
args = parser.parse_args()
if not args.ffmpeg or not args.ffprobe:
    raise SystemExit("ffmpeg and ffprobe are required")


def inspect(path):
    metadata = json.loads(subprocess.check_output([
        args.ffprobe, "-v", "error", "-count_frames", "-show_streams",
        "-show_format", "-of", "json", str(path),
    ]))
    hashes = subprocess.check_output([
        args.ffmpeg, "-v", "error", "-xerror", "-i", str(path),
        "-map", "0:v:0", "-f", "framemd5", "-",
    ]).decode()
    frames = [line.split(",")[-1].strip() for line in hashes.splitlines()
              if line and not line.startswith("#")]
    pcm = subprocess.check_output([
        args.ffmpeg, "-v", "error", "-xerror", "-i", str(path),
        "-map", "0:a:0", "-f", "s16le", "-",
    ])
    video = next(stream for stream in metadata["streams"]
                 if stream["codec_type"] == "video")
    return {
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "width": video["width"], "height": video["height"],
        "fps": video["avg_frame_rate"], "frameCount": len(frames),
        "pcmSha256": hashlib.sha256(pcm).hexdigest(), "pcmBytes": len(pcm),
        "frameHashes": frames,
    }


report = {"cases": [], "passed": True}
for case in ("flat", "static", "disabled", "motion", "combined", "static-focus", "motion-focus"):
    before = inspect(args.directory / f"before-{case}.mp4")
    after = inspect(args.directory / f"after-{case}.mp4")
    changed = [index for index, (a, b) in enumerate(zip(
        before["frameHashes"], after["frameHashes"])) if a != b]
    same_format = all(before[key] == after[key] for key in (
        "width", "height", "fps", "frameCount", "pcmSha256", "pcmBytes"))
    expected_format = (after["width"], after["height"], after["fps"],
                       after["frameCount"]) == (1280, 720, "60/1", 540)
    changed_as_expected = bool(changed) if case in ("motion", "combined", "motion-focus") else not changed
    passed = same_format and expected_format and changed_as_expected
    for value in (before, after):
        value.pop("frameHashes")
    result = {"case": case, "before": before, "after": after,
              "changedFrameCount": len(changed), "changedFrames": changed,
              "sameFormatAndPcm": same_format, "passed": passed}
    report["cases"].append(result)
    report["passed"] = report["passed"] and passed
    print(json.dumps({key: result[key] for key in (
        "case", "changedFrameCount", "sameFormatAndPcm", "passed")}), flush=True)
(args.directory / "export-comparison.json").write_text(
    json.dumps(report, ensure_ascii=False, indent=2) + "\n")
if not report["passed"]:
    raise SystemExit(1)
