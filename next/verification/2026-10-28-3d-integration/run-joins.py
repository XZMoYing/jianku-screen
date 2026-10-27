import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time

parser = argparse.ArgumentParser()
parser.add_argument("directory", type=Path)
parser.add_argument("--cli", type=Path, required=True)
parser.add_argument("--phase", choices=["before", "after"], required=True)
args = parser.parse_args()
for name in ["whole", "aligned", "offgrid", "hardcut"]:
    marker = json.loads((args.directory / "fixtures" / f"{name}.jks" / ".jianku-3d-integration-fixture.json").read_text())
    if marker != {"kind": "jianku-3d-integration", "version": 1}:
        raise SystemExit("Only owned synthetic fixtures are accepted")
    for fps in [30, 60, 120]:
        if (args.directory / f"{args.phase}-{name}-{fps}.mp4").exists():
            raise SystemExit("Existing exports are never replaced")
report = {"cliSha256": hashlib.sha256(args.cli.read_bytes()).hexdigest(), "runs": []}
for fps in [30, 60, 120]:
    for name in ["whole", "aligned", "offgrid", "hardcut"]:
        start = time.monotonic()
        with (args.directory / f"{args.phase}-{name}-{fps}.log").open("wb") as log:
            proc = subprocess.run([
                str(args.cli.resolve()), "--json", "export", str(args.directory / "fixtures" / f"{name}.jks"),
                "--output", str(args.directory / f"{args.phase}-{name}-{fps}.mp4"), "--format", "mp4",
                "--fps", str(fps), "--resolution", "1280x720", "--quality", "maximum",
            ], stdout=log, stderr=subprocess.STDOUT)
        value = {"name": name, "fps": fps, "exitCode": proc.returncode, "seconds": time.monotonic() - start}
        report["runs"].append(value)
        (args.directory / f"{args.phase}-runs.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(value), flush=True)
        if proc.returncode:
            raise SystemExit(proc.returncode)
