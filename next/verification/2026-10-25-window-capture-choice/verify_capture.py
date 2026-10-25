import json
import subprocess
import sys
from pathlib import Path


def probe(path, entries):
    return json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", entries, "-of", "json", str(path),
    ]))


def verify(projects, samples):
    results = []
    for event in samples:
        bookmark = event["bookmark"]
        segment = projects[str(event["isolated"])] / f"content/segments/segment-{bookmark['recordingSegment']}"
        media = segment / "display.mp4"
        stream = probe(media, "stream=width,height")["streams"][0]
        width, height = stream["width"], stream["height"]
        frames = probe(media, "frame=best_effort_timestamp_time")["frames"]
        index = max(i for i, frame in enumerate(frames)
                    if float(frame["best_effort_timestamp_time"]) <= bookmark["time"])
        pixels = subprocess.check_output([
            "ffmpeg", "-nostdin", "-v", "error", "-i", str(media),
            "-vf", f"select='eq(n,{index})'", "-frames:v", "1",
            "-fps_mode", "passthrough", "-pix_fmt", "rgb24", "-f", "rawvideo", "-",
        ])
        assert len(pixels) == width * height * 3
        red = green = total = 0
        white = []
        for y in range(0, height, 4):
            for x in range(0, width, 4):
                at = (y * width + x) * 3
                r, g, b = pixels[at:at + 3]
                total += 1
                red += r > 140 and r > g * 2 and r > b * 2
                green += g > 100 and g > r * 1.4 and g > b * 1.1
                if .05 * width < x < .95 * width and .2 * height < y < .85 * height and min(r, g, b) > 235:
                    white.append((x / width, y / height))
        center = [sum(p[i] for p in white) / len(white) for i in [0, 1]] if white else None
        moves = json.loads((segment / "cursor.json").read_text())["moves"]
        preceding = [m for m in moves if m["time_ms"] <= bookmark["time"] * 1000]
        cursor = preceding[-1] if preceding else moves[0]
        error = max(abs(center[0] - cursor["x"]) * width,
                    abs(center[1] - cursor["y"]) * height) if center else None
        result = {
            "isolated": event["isolated"], "stage": event["label"],
            "sourceSegment": bookmark["recordingSegment"], "sourceTime": bookmark["time"],
            "width": width, "height": height, "frameIndex": index,
            "frameTime": float(frames[index]["best_effort_timestamp_time"]),
            "redRatio": round(red / total, 4), "greenRatio": round(green / total, 4),
            "whiteCenter": center, "cursor": {"x": cursor["x"], "y": cursor["y"]},
            "cursorErrorPixels": round(error, 2) if error is not None else None,
        }
        if not event["isolated"] and event["label"] == "cover":
            assert result["redRatio"] > .95, result
        else:
            assert result["redRatio"] < .01 and result["greenRatio"] > .3, result
            assert error is not None and error <= 5, result
        results.append(result)
    return results


if __name__ == "__main__":
    projects = {key: Path(value) for key, value in json.loads(Path(sys.argv[1]).read_text()).items()}
    events = [json.loads(line) for line in Path(sys.argv[2]).read_text().splitlines()]
    results = verify(projects, [event for event in events if event.get("phase") == "capture-sample"])
    Path(sys.argv[3]).write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n")
    print(f"Passed {len(results)} held-frame pixel and cursor comparisons")
