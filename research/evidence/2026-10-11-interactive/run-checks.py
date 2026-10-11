"""Rebuild the standalone pixel/interactive checks using the installed Qt runtime."""
from pathlib import Path
import argparse
import shlex
import subprocess
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument("--shadow-only", action="store_true")
args = parser.parse_args()
evidence = Path(__file__).resolve().parent
root = evidence.parents[2]
flags = shlex.split(subprocess.check_output(["pkg-config", "--cflags", "--libs", "Qt6Quick"], text=True))
common = ["clang++", "-std=c++20", "-O3", "-I" + str(root / "src/render"),
          '-DJIANKU_SOURCE_DIR="' + str(root) + '"']
with tempfile.TemporaryDirectory(prefix="jianku-interactive-") as temporary:
    work = Path(temporary)
    for label, renderer in [("before", evidence / "shadow-before-roi.cpp"),
                            ("after", root / "src/render/CanvasRenderer.cpp")]:
        binary = work / ("shadow-" + label)
        subprocess.run(common + [str(evidence / "shadow-check.cpp"), str(renderer),
                                 str(root / "src/render/CanvasLayout.cpp"), "-o", str(binary)] + flags, check=True)
        subprocess.run([str(binary), str(evidence / "shadow-baseline")], check=True)
    if not args.shadow_only:
        libexec = Path(subprocess.check_output(["qtpaths", "--query", "QT_HOST_LIBEXECS"], text=True).strip())
        header = root / "src/render/CanvasPreview.h"
        moc = work / "moc-canvas.cpp"
        subprocess.run([str(libexec / "moc"), str(header), "-f" + str(header), "-o", str(moc)], check=True)
        binary = work / "live-canvas"
        subprocess.run(common + [str(evidence / "live-canvas-check.cpp"), str(moc),
                                 str(root / "src/render/CanvasPreview.cpp"),
                                 str(root / "src/render/CanvasRenderer.cpp"),
                                 str(root / "src/render/CanvasLayout.cpp"), "-o", str(binary)] + flags, check=True)
        subprocess.run([str(binary)], check=True)
