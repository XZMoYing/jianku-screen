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
cases = json.loads((args.directory / "cases.json").read_text())
for entry in cases:
    project = args.directory / f"{entry['name']}.jks"
    marker = json.loads((project / ".jianku-3d-spring-fixture.json").read_text())
    if marker != {"kind": "jianku-3d-spring", "version": 1}:
        raise SystemExit("Only owned synthetic fixtures are accepted")
    if (args.directory / f"{args.phase}-{entry['name']}.mp4").exists():
        raise SystemExit("Existing exports are never replaced")
report = {"cliSha256": hashlib.sha256(args.cli.read_bytes()).hexdigest(), "runs": []}
for entry in cases:
    name = entry["name"]
    start = time.monotonic()
    with (args.directory / f"{args.phase}-{name}.log").open("wb") as log:
        result = subprocess.run([
            str(args.cli.resolve()), "--json", "export",
            str(args.directory / f"{name}.jks"), "--output",
            str(args.directory / f"{args.phase}-{name}.mp4"),
            "--format", "mp4", "--fps", "60", "--resolution", "1280x720",
            "--quality", "maximum",
        ], stdout=log, stderr=subprocess.STDOUT)
    run = {"case": name, "exitCode": result.returncode,
           "elapsedSeconds": time.monotonic() - start}
    report["runs"].append(run)
    (args.directory / f"{args.phase}-runs.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(run), flush=True)
    if result.returncode:
        raise SystemExit(result.returncode)
