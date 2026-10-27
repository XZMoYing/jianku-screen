import argparse
import gzip
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
        args.ffprobe, "-v", "error", "-count_frames", "-show_streams", "-of", "json", str(path),
    ]))
    hashes = subprocess.check_output([
        args.ffmpeg, "-v", "error", "-xerror", "-i", str(path),
        "-map", "0:v:0", "-f", "framemd5", "-",
    ])
    with gzip.open(path.with_suffix(".framemd5.gz"), "wb") as output:
        output.write(hashes)
    frames = [line.split(",")[-1].strip() for line in hashes.decode().splitlines()
              if line and not line.startswith("#")]
    pcm = subprocess.check_output([
        args.ffmpeg, "-v", "error", "-xerror", "-i", str(path),
        "-map", "0:a:0", "-f", "s16le", "-",
    ])
    video = next(stream for stream in metadata["streams"] if stream["codec_type"] == "video")
    return {
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "width": video["width"], "height": video["height"], "fps": video["avg_frame_rate"],
        "frameCount": len(frames), "pcmSha256": hashlib.sha256(pcm).hexdigest(),
        "pcmBytes": len(pcm), "frames": frames,
    }


def compare(name, before, after, expected):
    changed = [index for index, (a, b) in enumerate(zip(before["frames"], after["frames"])) if a != b]
    same_format = all(before[key] == after[key] for key in (
        "width", "height", "fps", "frameCount", "pcmSha256", "pcmBytes"))
    expected_format = (after["width"], after["height"], after["fps"], after["frameCount"]) == (1280, 720, "60/1", 540)
    passed = same_format and expected_format and (not changed if expected == "identical" else bool(changed))
    result = {
        "case": name, "expected": expected, "passed": passed,
        "before": {k: v for k, v in before.items() if k != "frames"},
        "after": {k: v for k, v in after.items() if k != "frames"},
        "changedFrameCount": len(changed), "changedFrames": changed, "sameFormatAndPcm": same_format,
    }
    print(json.dumps({key: result[key] for key in ("case", "passed", "changedFrameCount", "sameFormatAndPcm")}), flush=True)
    return result


report = {"cases": [], "passed": True}
after_exports = {}
for entry in json.loads((args.directory / "cases.json").read_text()):
    name = entry["name"]
    before = inspect(args.directory / f"before-{name}.mp4")
    after = inspect(args.directory / f"after-{name}.mp4")
    after_exports[name] = after
    report["cases"].append(compare(name, before, after, entry["expected"]))
report["cases"].append(compare("split-natural-sharp", after_exports["natural-sharp"], after_exports["natural-split-sharp"], "identical"))
report["passed"] = all(case["passed"] for case in report["cases"])
(args.directory / "export-comparison.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
if not report["passed"]:
    raise SystemExit(1)
