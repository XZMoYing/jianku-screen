from contextlib import nullcontext
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
NATIVE = ROOT / "target/native-deps"
CACHE = NATIVE / "jianku-scrcpy"
SOURCE = CACHE / "scrcpy-4.1"
BUILD = CACHE / "build"


def run(args, **kwargs):
    result = subprocess.run(args, capture_output=True, **kwargs)
    if result.returncode:
        raise RuntimeError(result.stderr.decode() if isinstance(result.stderr, bytes) else result.stderr)
    return result.stdout


def packets(path):
    data = json.loads(run([
        "ffprobe", "-v", "error", "-show_packets", "-show_data_hash", "sha256",
        "-show_entries", "packet=stream_index,pts_time,dts_time,duration_time,data_hash",
        "-of", "json", str(path),
    ]))
    return data["packets"]


def main():
    environment = os.environ.copy()
    environment["DYLD_LIBRARY_PATH"] = os.pathsep.join([str(CACHE), str(NATIVE / "lib")])
    output_directory = os.environ.get("JIANKU_TAIL_FIXTURE_OUTPUT")
    if output_directory:
        Path(output_directory).mkdir(parents=True, exist_ok=True)
    with (nullcontext(output_directory) if output_directory else tempfile.TemporaryDirectory(prefix="jianku-android-tail-")) as directory:
        work = Path(directory)
        fixture = work / "recorder-fixture"
        sdl = shlex.split(run(["pkg-config", "--cflags", "--libs", "sdl3"]).decode())
        command = [
            "cc", "-DNDEBUG", "-D_DARWIN_C_SOURCE", "-std=c11", "-Wall", "-Wextra", "-Werror",
            "-I", str(SOURCE / "app/src"), "-I", str(BUILD / "app"),
            "-I", str(NATIVE / "include"), str(ROOT / "scripts/scrcpy/recorder_fixture.c"),
            *[str(BUILD / f"app/scrcpy.p/src_util_{name}.c.o") for name in ["memory", "str", "strbuf", "thread"]],
            str(BUILD / "app/scrcpy.p/src_compat.c.o"),
            "-L", str(NATIVE / "lib"), "-lavformat", "-lavcodec", "-lavutil", *sdl,
            "-o", str(fixture),
        ]
        run(command)
        short = work / "static.mp4"
        sparse = work / "sparse.mp4"
        audio = work / "audio.mp4"
        common = ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=96x160:rate=10"]
        run([*common, "-t", "1.1", "-c:v", "libx264", "-bf", "0", str(short)])
        run([*common, "-t", "4.1", "-vf", "select='lte(t,1)+gte(t,3)'", "-fps_mode", "vfr", "-c:v", "libx264", "-bf", "0", str(sparse)])
        run(["ffmpeg", "-y", "-v", "error", "-i", str(short), "-f", "lavfi", "-i", "sine=frequency=700:sample_rate=48000", "-t", "6", "-c:v", "copy", "-c:a", "aac", str(audio)])
        observations = []
        controls = {}
        for source in [short, sparse, audio]:
            for mode in ["normal", "error", "eos-before-stop"]:
                for offset in ([0, 250000] if source == audio else [0]):
                    output = work / f"{source.stem}-{mode}-{offset}.mp4"
                    original_hash = hashlib.sha256(source.read_bytes()).hexdigest()
                    result = subprocess.run([str(fixture), str(source), str(output), mode, str(offset)], env=environment, capture_output=True, text=True)
                    if result.returncode:
                        raise RuntimeError(result.stderr)
                    timing_line = next(line for line in result.stderr.splitlines() if line.startswith("JIANKU_RECORDING_TIMING "))
                    timing = json.loads(timing_line.split(" ", 1)[1])
                    before, after = packets(source), packets(output)
                    assert hashlib.sha256(source.read_bytes()).hexdigest() == original_hash
                    for stream_index in sorted({packet["stream_index"] for packet in before}):
                        original = [packet for packet in before if packet["stream_index"] == stream_index]
                        recorded = [packet for packet in after if packet["stream_index"] == stream_index]
                        assert len(original) == len(recorded)
                        origin = timing["originPtsUs"] / 1_000_000 - 10
                        for old, new in zip(original, recorded):
                            assert old["data_hash"] == new["data_hash"]
                            expected_pts = float(old["pts_time"]) + (offset / 1_000_000 if stream_index == 0 else 0) - origin
                            assert abs(float(new["pts_time"]) - expected_pts) < 0.001, (source.stem, mode, offset, stream_index, old, new, expected_pts, timing)
                    signature = [{key:packet[key] for key in ["stream_index", "pts_time", "dts_time", "data_hash", *(["duration_time"] if packet["stream_index"] == 1 else [])]} for packet in after]
                    control_key = (source.stem, offset)
                    if control_key in controls:
                        assert signature == controls[control_key]
                    else:
                        controls[control_key] = signature
                    tail = [packet for packet in after if packet["stream_index"] == 0][-1]
                    actual_end = float(tail["pts_time"]) + float(tail["duration_time"])
                    expected_end = 6 + offset / 1_000_000 - (timing["originPtsUs"] / 1_000_000 - 10)
                    if mode == "normal":
                        assert abs(actual_end - expected_end) < 0.001, (actual_end, expected_end)
                    else:
                        assert abs(float(tail["duration_time"]) - 0.1) < 0.0001
                    run(["ffmpeg", "-y", "-v", "error", "-i", str(output), "-f", "null", "-"])
                    observations.append({"source":source.stem,"mode":mode,"videoOffsetUs":offset,"packetCount":len(after),"videoEndSeconds":actual_end,"timing":timing})
        print(json.dumps({"passed":len(observations),"checks":"All encoded payload hashes and packet timestamps preserved; delayed first frame, video/audio origin, sparse middle, normal stop, errors and EOS tested; all outputs fully decoded.","cases":observations}, indent=2))


if __name__ == "__main__":
    main()
