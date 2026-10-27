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


def read(phase, name, fps):
    path = args.directory / f"{phase}-{name}-{fps}.mp4"
    probe = json.loads(subprocess.check_output([
        args.ffprobe, "-v", "error", "-count_frames", "-show_streams", "-of", "json", str(path),
    ]))
    stream = next(s for s in probe["streams"] if s["codec_type"] == "video")
    assert (stream["width"], stream["height"], stream["avg_frame_rate"], int(stream["nb_read_frames"])) == (1280, 720, f"{fps}/1", 9 * fps)
    hashes = subprocess.check_output([
        args.ffmpeg, "-v", "error", "-xerror", "-i", str(path), "-map", "0:v:0", "-f", "framemd5", "-",
    ])
    with gzip.open(path.with_suffix(".framemd5.gz"), "wb") as out:
        out.write(hashes)
    frames = [line.split(",")[-1].strip() for line in hashes.decode().splitlines() if line and not line.startswith("#")]
    pcm = subprocess.check_output([
        args.ffmpeg, "-v", "error", "-xerror", "-i", str(path), "-map", "0:a:0", "-f", "s16le", "-",
    ])
    return {"frames": frames, "pcm": hashlib.sha256(pcm).hexdigest(), "fileSha256": hashlib.sha256(path.read_bytes()).hexdigest()}


report = {"checks": [], "baselineDiscontinuities": [], "passed": True}
for fps in [30, 60, 120]:
    media = {(phase, name): read(phase, name, fps) for phase in ["before", "after"] for name in ["whole", "aligned", "offgrid", "hardcut"]}
    for name in ["aligned", "offgrid"]:
        changed = [index for index, (a, b) in enumerate(zip(media["before", "whole"]["frames"], media["before", name]["frames"])) if a != b]
        report["baselineDiscontinuities"].append({"fps": fps, "case": name, "changedFrames": changed})
    for name, a, b in [
        ("whole-preserved", ("before", "whole"), ("after", "whole")),
        ("authored-cut-preserved", ("before", "hardcut"), ("after", "hardcut")),
        ("aligned-split", ("after", "whole"), ("after", "aligned")),
        ("offgrid-split", ("after", "whole"), ("after", "offgrid")),
    ]:
        left, right = media[a], media[b]
        changed = [index for index, (a, b) in enumerate(zip(left["frames"], right["frames"])) if a != b]
        passed = not changed and left["pcm"] == right["pcm"]
        check = {"fps": fps, "case": name, "passed": passed, "frameCount": 9 * fps, "changedFrames": changed, "samePcm": left["pcm"] == right["pcm"]}
        report["checks"].append(check)
        report["passed"] = report["passed"] and passed
        print(json.dumps(check), flush=True)
(args.directory / "join-comparison.json").write_text(json.dumps(report, indent=2) + "\n")
if not report["passed"]:
    raise SystemExit(1)
