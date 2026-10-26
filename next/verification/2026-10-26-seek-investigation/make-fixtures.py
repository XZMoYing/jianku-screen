import argparse
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("directory", type=Path)
parser.add_argument("--ffmpeg", default="ffmpeg")
args = parser.parse_args()
args.directory.mkdir(parents=True, exist_ok=False)


def encode(name, source, options):
	subprocess.run(
		[args.ffmpeg, "-v", "error", "-f", "lavfi", "-i", source, *options, str(args.directory / name)],
		check=True,
	)


base = ["-c:v", "libx264", "-threads", "2", "-preset", "ultrafast", "-crf", "18", "-pix_fmt", "yuv420p", "-g", "3600", "-keyint_min", "3600", "-sc_threshold", "0", "-bf", "2"]
encode("long-gop.mp4", "testsrc2=size=384x216:rate=60:duration=60", base)
encode("vfr.mp4", "testsrc2=size=384x216:rate=60:duration=6", ["-vf", "select='if(lt(t,2),not(mod(n,5)),if(lt(t,4),not(mod(n,2)),1))'", "-fps_mode", "vfr", *base])
encode("ntsc.mp4", "testsrc2=size=384x216:rate=30000/1001:duration=6", base)
subprocess.run([args.ffmpeg, "-v", "error", "-itsoffset", "2", "-i", str(args.directory / "vfr.mp4"), "-c", "copy", "-copyts", str(args.directory / "offset.mp4")], check=True)
encode("long-gop-540p.mp4", "testsrc2=size=960x540:rate=60:duration=60", ["-c:v", "libx264", "-threads", "2", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p", "-g", "3600", "-keyint_min", "3600", "-sc_threshold", "0"])
subprocess.run([args.ffmpeg, "-v", "error", "-i", str(args.directory / "long-gop.mp4"), "-t", "1.2", "-c:v", "libx264", "-threads", "2", "-preset", "ultrafast", "-crf", "18", "-pix_fmt", "yuv420p", "-g", "72", "-sc_threshold", "0", str(args.directory / "short.mp4")], check=True)
