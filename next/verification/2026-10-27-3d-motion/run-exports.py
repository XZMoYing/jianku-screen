import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time

parser = argparse.ArgumentParser()
parser.add_argument("directory", type=Path)
parser.add_argument("--before-cli", type=Path, required=True)
parser.add_argument("--after-cli", type=Path, required=True)
args = parser.parse_args()
cases = ("flat", "static", "disabled", "motion", "combined", "static-focus", "motion-focus")
for case in cases:
    for phase in ("before", "after"):
        if (args.directory / f"{phase}-{case}.mp4").exists():
            raise SystemExit("Use fresh fixtures; existing exports are never replaced")
report = {"runs": [], "cliSha256": {}}
for phase, cli in (("before", args.before_cli), ("after", args.after_cli)):
    report["cliSha256"][phase] = hashlib.sha256(cli.read_bytes()).hexdigest()
    for case in cases:
        start = time.monotonic()
        with (args.directory / f"{phase}-{case}.log").open("wb") as log:
            result = subprocess.run([
                str(cli.resolve()), "--json", "export",
                str(args.directory / f"{case}.jks"), "--output",
                str(args.directory / f"{phase}-{case}.mp4"),
                "--format", "mp4", "--fps", "60", "--resolution", "1280x720",
                "--quality", "maximum",
            ], stdout=log, stderr=subprocess.STDOUT)
        run = {"phase": phase, "case": case, "exitCode": result.returncode,
               "elapsedSeconds": time.monotonic() - start}
        report["runs"].append(run)
        (args.directory / "export-runs.json").write_text(
            json.dumps(report, indent=2) + "\n")
        print(json.dumps(run), flush=True)
        if result.returncode:
            raise SystemExit(result.returncode)
