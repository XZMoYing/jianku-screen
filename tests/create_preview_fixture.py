"""Reproducible 10-second preview workload, with camera/cursor effects.

Usage: python3 tests/create_preview_fixture.py /tmp/preview-check/sample.jianku [--rate 30]
Creates synthetic media only; refuses to overwrite an existing project.
"""
import argparse
import json
import math
import pathlib
import shutil
import struct
import subprocess
import zlib

parser = argparse.ArgumentParser()
parser.add_argument("directory", type=pathlib.Path)
parser.add_argument("--rate", type=int, choices=(30, 60), default=60)
parser.add_argument("--size", choices=("3360x2100", "960x540"), default="3360x2100")
args = parser.parse_args()
width, height = map(int, args.size.split("x"))
root = args.directory
if (root / "project.json").exists():
    raise SystemExit("Use a fresh fixture directory; existing projects are preserved")
root.mkdir(parents=True, exist_ok=True)
ffmpeg = shutil.which("ffmpeg")
if not ffmpeg:
    raise SystemExit("ffmpeg is required")
subprocess.run([ffmpeg, "-v", "error", "-f", "lavfi", "-i",
                f"testsrc2=size={args.size}:rate={args.rate}:duration=10", "-f", "lavfi", "-i",
                "sine=frequency=220:duration=10", "-c:v", "libx264", "-preset", "ultrafast",
                "-crf", "28", "-c:a", "aac", "-pix_fmt", "yuv420p", "-y", str(root / "raw.mp4")], check=True)
manifest = {"schemaVersion": 1, "createdAt": "2026-10-10T12:00:00.000",
            "source": {"type": "display", "widthPx": width, "heightPx": height},
            "settings": {"outputAspectRatio": "16:9", "backgroundType": "gradient",
                         "gradientStartColor": "#29344f", "gradientEndColor": "#819cb8",
                         "backgroundPaddingRatio": 10, "windowBorderRadius": 12,
                         "shadowIntensity": .75, "shadowAngle": 90, "shadowDistance": 25,
                         "shadowBlur": 20, "muteMicrophone": True,
                         "cursorRotateOnXMovementRatio": 1, "cursorSize": 2, "motionBlurAmount": 1},
            "video": {"file": "raw.mp4", "durationNs": "10000000000",
                      "mediaZeroHostTimeNs": "1000000000", "frameCount": 10 * args.rate}}
(root / "project.json").write_text(json.dumps(manifest), encoding="utf-8")
(root / "video-frames.jsonl").write_text("".join(json.dumps({"mediaTimeNs": str(round(i * 1e9 / args.rate))}) + "\n"
                                               for i in range(10 * args.rate)), encoding="utf-8")
events = []
for i in range(600):
    t = i / 60
    event = {"type": "mouseMoved", "withinVideo": True, "mediaTimeNs": str(round(t * 1e9)),
             "xPx": (1680 + 900 * math.sin(t * 2.6)) * width / 3360,
             "yPx": (1050 + 550 * math.sin(t * 3.8)) * height / 2100}
    events.append(event)
    if i % 90 == 0:
        events.extend([dict(event, type="mouseDown"), dict(event, type="mouseUp", mediaTimeNs=str(round((t + .08) * 1e9)))])
events.sort(key=lambda v: int(v["mediaTimeNs"]))
(root / "pointer-timeline.jsonl").write_text("".join(json.dumps(e) + "\n" for e in events), encoding="utf-8")
(root / "automatic-zooms.json").write_text(json.dumps({"ranges": [
    {"startTimeMs": a, "endTimeMs": b, "zoom": 2.2, "isSystem": True}
    for a, b in [(500, 2300), (3200, 4800), (5500, 7300), (8000, 9500)]]}), encoding="utf-8")

# A synthetic RGBA pointer; no user's screen/cursor image is included.
def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)


rows = bytearray()
for y in range(64):
    rows.append(0)
    for x in range(48):
        opaque = (4 <= x <= 4 + y * .45 and 3 <= y < 50) or (15 <= x < 24 and 32 <= y < 59)
        rows.extend((250, 250, 250, 255) if opaque else (0, 0, 0, 0))
(root / "cursor.png").write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 48, 64, 8, 6, 0, 0, 0))
                                + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))
(root / "cursors.json").write_text(json.dumps({"arrow": {"image": "cursor.png", "widthPx": 48, "heightPx": 64,
                                                      "hotSpotXPx": 4, "hotSpotYPx": 3}}), encoding="utf-8")
(root / "cursor-timeline.jsonl").write_text(json.dumps({"withinVideo": True, "available": True, "cursorId": "arrow",
                                                      "mediaTimeNs": "0"}) + "\n", encoding="utf-8")
print(f"Created {root}: {args.size}, {args.rate} fps, 10s, four zoom intervals and cursor events")
