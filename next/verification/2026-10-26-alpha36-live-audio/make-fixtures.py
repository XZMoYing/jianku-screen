import argparse
import json
from pathlib import Path
import shutil
import struct
import subprocess
import wave

parser = argparse.ArgumentParser()
parser.add_argument("--directory", type=Path, required=True)
parser.add_argument("--ffmpeg", default=shutil.which("ffmpeg"))
args = parser.parse_args()
if not args.ffmpeg:
    raise SystemExit("ffmpeg is required")
project = args.directory / "多轨播放回归.jks"
content = project / "content"
content.mkdir(parents=True, exist_ok=True)
video = content / "display.mp4"
if not video.exists():
    subprocess.run([
        args.ffmpeg, "-v", "error", "-f", "lavfi", "-i",
        "nullsrc=size=320x180:rate=30:duration=120,geq=lum='40+40*mod(floor(T),4)':cb=128:cr=128",
        "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-g", "30",
        "-pix_fmt", "yuv420p", str(video),
    ], check=True)
for name, value in [("music-a.wav", 8000), ("music-b.wav", 4000)]:
    destination = content / name
    if destination.exists():
        continue
    with wave.open(str(destination), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(48000)
        for second in range(180):
            sample = 6000 if name == "music-b.wav" and second >= 120 else value
            output.writeframes(struct.pack("<h", sample) * 48000)
metadata = {
    "pretty_name": "多轨播放回归", "platform": "MacOS",
    "segments": [{"display": {"path": "content/display.mp4", "fps": 30},
                  "camera": None, "audio": None, "cursor": None} for _ in range(4)],
    "status": {"status": "Complete"}, "cursors": {},
}
configuration = {
    "background": {"source": {"type": "color", "value": [235, 230, 213], "alpha": 255},
                   "padding": 14, "inset": 100, "rounding": 7.5, "shadow": 60,
                   "frame": {"style": "browser", "theme": "light"}},
    "camera": {"hide": True}, "cursor": {"hide": True}, "screenMotionBlur": 1,
    "timeline": {
        "segments": [{"recordingSegment": i, "start": i * 30.0, "end": i * 30.0 + 15,
                      "timescale": 1} for i in range(4)],
        "zoomSegments": [{"start": 1, "end": 4, "amount": 1.5, "mode": "auto"}],
    },
}
for name, value in [("recording-meta.json", metadata), ("project-config.json", configuration)]:
    destination = project / name
    if destination.exists():
        continue
    destination.write_text(json.dumps(value, ensure_ascii=False, indent="\t") + "\n")
print(project)
