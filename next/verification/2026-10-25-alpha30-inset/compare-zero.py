import argparse
import base64
import hashlib
import json
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("cli", type=Path)
parser.add_argument("fixtures", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()
results = []
for name in ["plain", "browser", "phone"]:
    baseline = json.loads((args.fixtures / f"{name}-alpha29.json").read_text())
    command = [
        str(args.cli), "export-preview", str(args.fixtures / f"{name}.jks"),
        "--frame-time", "1", "--settings-json",
        json.dumps({"fps": 60, "resolution_base": {"x": 1280, "y": 720},
                    "compression_bpp": 0.3}),
    ]
    result = subprocess.run(command, capture_output=True, check=True)
    current = json.loads(result.stdout)
    previous_jpeg = base64.b64decode(baseline["jpeg_base64"])
    current_jpeg = base64.b64decode(current["jpeg_base64"])
    assert previous_jpeg == current_jpeg, f"Zero inset changed pixels: {name}"
    results.append({"frame": name, "jpegBytes": len(current_jpeg),
                    "sha256": hashlib.sha256(current_jpeg).hexdigest(),
                    "equalToAlpha29": True})
args.output.write_text(json.dumps({"baseline": "installed alpha.29 release",
                                 "results": results}, indent=2) + "\n")
print(json.dumps(results, indent=2))
