import argparse
import hashlib
import json
from pathlib import Path
import plistlib
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument("bundles", type=Path, nargs=3)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
if args.output.exists():
    raise SystemExit("Existing reports are never replaced")
names = [
    "Jianku Screen Next", "cap-cli", "cap-muxer", "cap-exporter",
    "jianku-device-capture", "jianku-android-capture",
]
report = {
    "sourceCommit": "92775e929f0f9820dd910b44b2909cf396591270",
    "bundles": [],
    "passed": False,
}
for bundle in args.bundles:
    with (bundle / "Contents/Info.plist").open("rb") as source:
        info = plistlib.load(source)
    assert info["CFBundleIdentifier"] == "com.jianku.screen.next"
    assert info["CFBundleShortVersionString"] == "0.2.0-alpha.39"
    assert info["CFBundleVersion"] == "2026.39.0"
    subprocess.run(["codesign", "--verify", "--deep", "--strict", str(bundle)], check=True)
    binaries = {
        name: hashlib.sha256((bundle / "Contents/MacOS" / name).read_bytes()).hexdigest()
        for name in names
    }
    report["bundles"].append({
        "path": str(bundle.resolve()), "version": info["CFBundleShortVersionString"],
        "build": info["CFBundleVersion"], "binaries": binaries,
        "strictSignature": True, "signature": "ad-hoc; no Developer ID or notarization",
    })
assert all(item["binaries"] == report["bundles"][0]["binaries"] for item in report["bundles"])
report["passed"] = True
args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(report, ensure_ascii=False, indent=2))
