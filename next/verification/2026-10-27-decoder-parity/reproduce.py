import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile


def digest(data):
    return hashlib.sha256(data).hexdigest()


def compare(first, second):
    if len(first) != len(second):
        raise ValueError(f"Plane sizes differ: {len(first)} / {len(second)}")
    differences = [abs(a - b) for a, b in zip(first, second)]
    return {
        "bytes": len(first),
        "differentBytes": sum(value != 0 for value in differences),
        "maxDifference": max(differences, default=0),
        "firstSha256": digest(first),
        "secondSha256": digest(second),
    }


def run(command, environment):
    return subprocess.run(
        [str(part) for part in command],
        env=environment,
        capture_output=True,
        text=True,
        check=True,
        timeout=120,
    ).stdout


def main():
    parser = argparse.ArgumentParser()
    evidence = Path(__file__).resolve().parent
    parser.add_argument("--cap-root", type=Path, default=evidence.parents[1] / "cap")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    native = args.cap_root.resolve() / "target/native-deps"
    library = native / "lib/libavcodec.dylib"
    if not library.exists():
        raise FileNotFoundError(f"Bundled FFmpeg is missing: {library}")
    if args.output.exists():
        raise FileExistsError(f"Choose a new report path: {args.output}")
    environment = dict(os.environ)
    environment.pop("DYLD_INSERT_LIBRARIES", None)
    environment["DYLD_LIBRARY_PATH"] = str(native / "lib")
    result = {
        "scope": "Diagnostic comparison of 110 decoded frames per track; no product changes, no tolerance-based pass classification",
        "bundledCodecSha256": digest(library.read_bytes()),
        "inputs": {},
        "tracks": [],
    }
    with tempfile.TemporaryDirectory(prefix="jianku-decoder-parity-") as directory:
        working = Path(directory)
        (working / "media").mkdir()
        for track in ["display", "camera"]:
            source = gzip.decompress((evidence / f"{track}.mp4.gz").read_bytes())
            (working / f"media/{track}.mp4").write_bytes(source)
            result["inputs"][track] = {"bytes": len(source), "sha256": digest(source)}
        run(
            [
                "/usr/bin/xcrun", "clang", "-O2", "-I", native / "include",
                evidence / "ffmpeg-native.c", "-L", native / "lib",
                "-lavcodec", "-lavformat", "-lavutil", "-framework", "CoreVideo",
                "-o", working / "ffmpeg-native",
            ],
            environment,
        )
        run(
            [
                "/usr/bin/xcrun", "swiftc", "-O", "-parse-as-library",
                evidence / "av-output.swift", "-o", working / "av-output",
            ],
            environment,
        )
        result["ffmpegLog"] = run([working / "ffmpeg-native", working], environment)
        result["avLog"] = run([working / "av-output", working], environment)
        for track, samples in [("display", [7, 19, 52, 97]), ("camera", [9, 18, 45, 81])]:
            for mode in ["early", "late", "software"]:
                row = {
                    "track": track, "mode": mode, "frames": 110,
                    "differentLumaBytes": 0, "differentChromaBytes": 0,
                    "maxLumaDifference": 0, "maxChromaDifference": 0,
                    "changedFrames": 0, "nativeVsDownloadDifferentBytes": 0,
                    "explicitSizeVsNativeSizeDifferentBytes": 0, "samples": [],
                }
                for index in range(110):
                    changed = False
                    planes = []
                    for plane, label in [(0, "Luma"), (1, "Chroma")]:
                        reference = (working / f"swift-sized-{track}/{index}-{plane}.bin").read_bytes()
                        actual = (working / f"c-{track}-{mode}-{index}-cpu-{plane}.bin").read_bytes()
                        comparison = compare(actual, reference)
                        row[f"different{label}Bytes"] += comparison["differentBytes"]
                        row[f"max{label}Difference"] = max(row[f"max{label}Difference"], comparison["maxDifference"])
                        changed |= comparison["differentBytes"] != 0
                        native_size = (working / f"swift-native-{track}/{index}-{plane}.bin").read_bytes()
                        row["explicitSizeVsNativeSizeDifferentBytes"] += compare(reference, native_size)["differentBytes"]
                        if mode != "software":
                            surface = (working / f"c-{track}-{mode}-{index}-native-{plane}.bin").read_bytes()
                            row["nativeVsDownloadDifferentBytes"] += compare(surface, actual)["differentBytes"]
                        planes.append({"plane": label, **comparison})
                    row["changedFrames"] += int(changed)
                    if index in samples:
                        row["samples"].append({"sourceFrame": index, "planes": planes})
                result["tracks"].append(row)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(args.output)
    for row in result["tracks"]:
        print(row["track"], row["mode"], row["differentLumaBytes"], row["differentChromaBytes"], row["maxChromaDifference"])


if __name__ == "__main__":
    main()
