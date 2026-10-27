import argparse
import json
from pathlib import Path
import shutil

parser = argparse.ArgumentParser()
parser.add_argument("--base-project", type=Path, required=True)
parser.add_argument("--directory", type=Path, required=True)
args = parser.parse_args()
templates = Path(__file__).parent / "inputs"
if args.directory.exists():
    raise SystemExit("Use a new output directory; existing files are never replaced")
if not (args.base_project / "content/display.mp4").is_file():
    raise SystemExit("A copy of the nine-second synthetic base project is required")
args.directory.mkdir(parents=True)
for case in ("flat", "static", "disabled", "motion", "combined", "static-focus", "motion-focus"):
    project = args.directory / f"{case}.jks"
    shutil.copytree(args.base_project, project)
    for name, source in (
        ("project-config.json", templates / f"{case}.json"),
        ("recording-meta.json", templates / "recording-meta.json"),
    ):
        shutil.copyfile(source, project / name)
    (project / ".jianku-3d-comfort.json").write_text(json.dumps({
        "kind": "jianku-3d-comfort", "version": 1,
    }) + "\n")
    print(project)
