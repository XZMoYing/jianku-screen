"""Make an isolated real-video project for the app's explicit editor check.

Usage: python3 tests/create_editor_fixture.py /tmp/jianku-editor-check/sample.jianku
"""
import json
import pathlib
import shutil
import subprocess
import sys

root = pathlib.Path(sys.argv[1])
root.mkdir(parents=True, exist_ok=True)
for name in ("appearance.json", "edit.json"):
    (root / name).unlink(missing_ok=True)
ffmpeg = shutil.which("ffmpeg")
if not ffmpeg:
    raise SystemExit("ffmpeg is required")
subprocess.run([ffmpeg, "-v", "error", "-f", "lavfi", "-i",
                "testsrc2=size=960x600:rate=30:duration=5", "-f", "lavfi", "-i",
                "sine=frequency=220:duration=5", "-c:v", "libx264", "-preset", "ultrafast",
                "-c:a", "aac", "-pix_fmt", "yuv420p", "-y", str(root / "raw.mp4")], check=True)
manifest = {"schemaVersion": 1, "createdAt": "2026-10-10T12:00:00.000",
            "source": {"type": "display", "widthPx": 960, "heightPx": 600},
            "settings": {"outputAspectRatio": "16:9", "backgroundType": "gradient",
                         "gradientStartColor": "#29344f", "gradientEndColor": "#819cb8",
                         "backgroundPaddingRatio": 10, "windowBorderRadius": 12,
                         "shadowIntensity": .75, "shadowAngle": 90, "shadowDistance": 25,
                         "shadowBlur": 20, "muteMicrophone": True},
            "video": {"file": "raw.mp4", "durationNs": "5000000000",
                      "mediaZeroHostTimeNs": "1000000000", "frameCount": 150}}
(root / "project.json").write_text(json.dumps(manifest), encoding="utf-8")
frames = [{"mediaTimeNs": str(round(i * 1e9 / 30))} for i in range(150)]
(root / "video-frames.jsonl").write_text("".join(json.dumps(f) + "\n" for f in frames))
for name in ("pointer-timeline.jsonl", "cursor-timeline.jsonl"):
    (root / name).write_text("")

if "--focus" in sys.argv:
    events = [{"type": "mouseMoved", "withinVideo": True, "mediaTimeNs": str(i * 500_000_000), "xPx": 240 + (i % 3) * 100, "yPx": 200} for i in range(10)]
    (root / "pointer-timeline.jsonl").write_text("".join(json.dumps(e) + "\n" for e in events))
    (root / "automatic-zooms.json").write_text(json.dumps({"ranges": [{"startTimeMs": 1000, "endTimeMs": 2500, "zoom": 2, "isSystem": True}]}))
