import argparse
import json
import os
from pathlib import Path
import subprocess
import time


def main():
    evidence = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--cap-root", type=Path, default=evidence.parents[1] / "cap")
    parser.add_argument("--fps", type=int, choices=[30, 60], default=60)
    parser.add_argument("--minutes", type=int, choices=[10, 30, 60], nargs="+", default=[10, 30, 60])
    parser.add_argument("--replay-rounds", type=int, choices=range(1, 21), default=3)
    parser.add_argument("--trace", action="store_true")
    args = parser.parse_args()
    cap = args.cap_root.resolve()
    binary = cap / "target/release/examples/long-project-check"
    if not binary.exists():
        raise FileNotFoundError("Build the cap-editor long-project-check release example first")
    args.output.mkdir(parents=True)
    environment = dict(os.environ)
    environment.pop("DYLD_INSERT_LIBRARIES", None)
    environment.pop("CAP_EDITOR_FORCE_FFMPEG_DECODER", None)
    environment["DYLD_LIBRARY_PATH"] = (
        str(cap / "target/native-deps/lib") + ":" + str(cap / "target/native-deps/onnxruntime/lib")
    )
    results = []
    for minutes in args.minutes:
        project = args.directory / f"{minutes}分钟多轨回归.jks"
        report = args.output / f"{minutes}min.json"
        samples = []
        started = time.monotonic()
        with (args.output / f"{minutes}min.log").open("w") as log:
            process = subprocess.Popen(
                [str(binary), str(project), str(report), str(args.fps), str(args.replay_rounds)]
                + (["trace"] if args.trace else []),
                cwd=cap, env=environment, stdout=log, stderr=subprocess.STDOUT,
            )
            try:
                while process.poll() is None:
                    if time.monotonic() - started > 120:
                        raise TimeoutError("Owned headless check exceeded 120 seconds")
                    resident = subprocess.run(
                        ["ps", "-p", str(process.pid), "-o", "rss="],
                        capture_output=True, text=True, check=False,
                    ).stdout.strip()
                    if resident:
                        samples.append({"seconds": time.monotonic() - started, "rssBytes": int(resident) * 1024})
                    time.sleep(0.25)
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
        native = json.loads(report.read_text()) if report.exists() else {"passed": False, "error": "No native report"}
        result = {
            "minutes": minutes, "fps": args.fps, "exitCode": process.returncode,
            "passed": native["passed"], "error": native["error"],
            "elapsedSeconds": time.monotonic() - started,
            "peakRssBytes": max((sample["rssBytes"] for sample in samples), default=0),
            "memorySamples": samples, "windows": native.get("windows", []),
            "naturalEndVerified": native.get("naturalEndVerified", False),
            "replayRounds": native.get("replayRounds", 3),
            "traceEnabled": native.get("traceEnabled", False),
        }
        results.append(result)
        (args.output / "summary.json").write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n")
        print(minutes, result["passed"], result["error"], result["peakRssBytes"], flush=True)
    if any(result["exitCode"] != 0 or not result["passed"] for result in results):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
