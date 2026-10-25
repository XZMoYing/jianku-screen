import argparse
import json
import os
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument("--repo", type=Path, required=True)
parser.add_argument("--fixtures", type=Path, default=Path("/private/tmp/jianku-alpha28-fixtures"))
parser.add_argument("--output", type=Path, default=Path("/private/tmp"))
parser.add_argument("--make-fixtures", action="store_true")
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
if args.make_fixtures:
    args.fixtures.mkdir(parents=True, exist_ok=True)
    for name, source, extra in [
        ("wallpaper.mp4", "testsrc2=size=960x540:rate=120:duration=60", []),
        ("wallpaper-vfr.mp4", "testsrc2=size=320x180:rate=60:duration=12", ["-vf", "select='if(lt(t,4),not(mod(n,4)),if(lt(t,8),not(mod(n,2)),1))'", "-fps_mode", "vfr"]),
    ]:
        destination = args.fixtures / name
        if not destination.exists():
            subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", source, *extra, "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-g", "600", "-keyint_min", "600", "-sc_threshold", "0", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(destination)], check=True)
checks = []
for kind, name in [("cfr", "wallpaper.mp4"), ("vfr", "wallpaper-vfr.mp4")]:
    fixture = args.fixtures / name
    if not fixture.is_file():
        raise SystemExit(f"Missing synthetic fixture: {fixture}; use --make-fixtures to generate it")
    env = dict(os.environ, DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer", CARGO_BUILD_JOBS="2", JIANKU_TEST_INDEX_CACHE_VIDEO=str(fixture), JIANKU_TEST_WALLPAPER_VIDEO=str(fixture))
    cases = [("cap-rendering", "reopened_precise_wallpaper_preserves_pixels_seeks_and_looping"), ("cap-rendering", "native_precise_sampling_matches_seek_loop_and_prefetch_reference")]
    if kind == "cfr":
        cases.insert(0, ("cap-video-decode", "nv12_index_cache_tests"))
    for crate, case in cases:
        log = args.output / f"jianku-alpha28-wallpaper-{kind}-{case}.log"
        command = ["cargo", "test", "--locked", "-p", crate, "--lib", case, "--", "--nocapture"]
        with log.open("w") as output:
            result = subprocess.run(command, cwd=args.repo, env=env, stdout=output, stderr=subprocess.STDOUT)
        print(json.dumps({"fixture": kind, "case": case, "exit_code": result.returncode, "log": str(log)}), flush=True)
        if result.returncode:
            raise SystemExit(result.returncode)
