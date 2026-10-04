#!/bin/sh
# Builds a distributable .dmg: Release build → bundled Qt + ffmpeg → ad-hoc signed → DMG.
#
# Three things make this more than "hdiutil create":
#
#   Qt. The Release bundle links against Homebrew's Qt by absolute path. It runs on this
#   machine and nowhere else. macdeployqt copies the frameworks in, but Homebrew's layout
#   is not the one it assumes: QtSvg and QtQuickTimeline live in their own formulae, and
#   libbrotlicommon ships with a broken install name. Both are repaired below, and the
#   result is checked rather than assumed.
#
#   ffmpeg. The app shells out to it for every export. A user who has never installed
#   Homebrew has none, so the DMG carries ffmpeg, ffprobe and their whole dylib closure,
#   with install names rewritten to @executable_path.
#
#   The checks. A bundle that only fails on someone else's machine is the expensive kind
#   of broken, so the script runs the app with an environment that cannot see Homebrew and
#   fails the build if anything is loaded from there.
#
# What is deliberately NOT attempted: Developer ID signing and notarisation. Both need a
# paid Apple account. Without them Gatekeeper warns on first open, which is what the
# release notes say; the ad-hoc signature is still required, because an unsigned bundle
# will not launch at all on Apple Silicon.
set -eu

REPO="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="${BUILD_DIR:-$REPO/build-release}"
APP="$BUILD/Jianku Screen.app"
STAGE="$BUILD/dmg-stage"
VERSION="${VERSION:-$(date +%Y.%m.%d)}"
DMG="$BUILD/简库镜传 $VERSION.dmg"
QT_PREFIX="${QT_PREFIX:-$(brew --prefix 2>/dev/null || echo /opt/homebrew)}"

[ -d "$APP" ] || {
    echo "先构建 Release：" >&2
    echo "  cmake -B build-release -DCMAKE_BUILD_TYPE=Release && cmake --build build-release" >&2
    exit 1
}
[ -x "$QT_PREFIX/bin/macdeployqt" ] || { echo "找不到 macdeployqt（QT_PREFIX=$QT_PREFIX）" >&2; exit 1; }

fail() { echo "  !! $*" >&2; exit 1; }

echo "==> 1/7 打包 ffmpeg"
BIN="$APP/Contents/Resources/bin"
rm -rf "$BIN"
mkdir -p "$BIN/lib"

# The closure of everything the two tools link against, minus what macOS provides.
# Keyed by basename so a symlink and its target are not copied twice.
collect() {
    /usr/bin/otool -L "$1" | /usr/bin/tail -n +2 | /usr/bin/awk '{print $1}' | while read -r dep; do
        case "$dep" in
            /usr/lib/*|/System/*|@*) continue ;;
        esac
        printf '%s\n' "$dep"
    done
}

queue="/tmp/jianku-dmg-queue.$$"
seen="/tmp/jianku-dmg-seen.$$"
: > "$queue"; : > "$seen"
for tool in ffmpeg ffprobe; do
    src="$(command -v "$tool")" || fail "找不到 $tool"
    /bin/cp "$(/usr/bin/readlink -f "$src" 2>/dev/null || echo "$src")" "$BIN/$tool"
    collect "$src" >> "$queue"
done

while [ -s "$queue" ]; do
    dep="$(/usr/bin/head -1 "$queue")"
    /usr/bin/sed -i '' '1d' "$queue"
    [ -e "$dep" ] || continue
    base="$(/usr/bin/basename "$dep")"
    /usr/bin/grep -qx "$base" "$seen" 2>/dev/null && continue
    /usr/bin/printf '%s\n' "$base" >> "$seen"
    /bin/cp "$dep" "$BIN/lib/$base"
    /bin/chmod u+w "$BIN/lib/$base"
    collect "$dep" >> "$queue"
done
rm -f "$queue" "$seen"
echo "    ffmpeg + $(ls "$BIN/lib" | wc -l | tr -d ' ') 个依赖库，$(du -sh "$BIN" | cut -f1)"

# @executable_path is the *directory* holding the binary — here Contents/Resources/bin —
# so the libraries one level down are at lib/, not ../lib. The first version of this
# script got that wrong, and the self-check below is what caught it: dyld looked in
# Resources/lib and aborted. Wrong here is invisible on the build machine, because
# Homebrew's own copy still resolves, and fatal on every other one.
for dylib in "$BIN"/lib/*.dylib; do
    /usr/bin/install_name_tool -id "@executable_path/lib/$(basename "$dylib")" "$dylib" 2>/dev/null
done
for dylib in "$BIN"/lib/*.dylib; do
    for dep in $(collect "$dylib"); do
        /usr/bin/install_name_tool -change "$dep" \
            "@executable_path/lib/$(basename "$dep")" "$dylib" 2>/dev/null || true
    done
done
for tool in ffmpeg ffprobe; do
    for dep in $(collect "$BIN/$tool"); do
        /usr/bin/install_name_tool -change "$dep" "@executable_path/lib/$(basename "$dep")" "$BIN/$tool" 2>/dev/null
    done
done

echo "==> 2/7 签名打包好的 ffmpeg（ad-hoc）"
# Before the check, not after. install_name_tool invalidates each binary's signature, and
# on Apple Silicon an invalid signature is not a warning: the kernel kills the process on
# exec. Checking first produced "Killed: 9", which reads exactly like a missing library and
# is not one. Signed individually because --deep does not reliably reach into a plain
# Resources subdirectory.
for binary in "$BIN"/lib/*.dylib "$BIN"/ffmpeg "$BIN"/ffprobe; do
    /usr/bin/codesign --force --sign - "$binary" 2>/dev/null || true
done
echo "    完成"

echo "==> 3/7 自检：断掉 Homebrew 的 ffmpeg 还能跑吗"
run_isolated() {
    env DYLD_LIBRARY_PATH=/nonexistent DYLD_FALLBACK_LIBRARY_PATH=/nonexistent "$@"
}
run_isolated "$BIN/ffmpeg" -hide_banner -version > /dev/null 2>&1 \
    || { run_isolated "$BIN/ffmpeg" -version 2>&1 | /usr/bin/head -3 >&2; fail "打包后的 ffmpeg 无法独立运行"; }
run_isolated "$BIN/ffprobe" -hide_banner -version > /dev/null 2>&1 \
    || fail "打包后的 ffprobe 无法独立运行"
# And once from / with a real encode, so a reference that only resolves by accident of the
# working directory, or a dylib that loads but cannot decode, does not slip through.
( cd / && run_isolated "$BIN/ffmpeg" -hide_banner -loglevel error \
    -f lavfi -i testsrc=d=0.1 -c:v libx264 -f null - ) > /dev/null 2>&1 \
    || fail "打包后的 ffmpeg 能启动但不能编码"
echo "    通过（版本查询 + 一次真实 H.264 编码）"

echo "==> 4/7 部署 Qt 框架与 QML 模块"
# -qmldir makes macdeployqt scan our QML and pull in the modules it imports. Without it
# QtQuick.Effects is missing and the app dies on the first MultiEffect.
"$QT_PREFIX/bin/macdeployqt" "$APP" -qmldir="$REPO/ui" 2>&1 \
    | /usr/bin/grep -E "Cannot resolve" | sort -u | /usr/bin/sed 's/^/    /' || true

# macdeployqt scans QML by module name, so it also drags in modules we never import:
# QtQuick.Timeline and VectorImage arrive with the QtQuick plugin and between them want
# QtQuickTimeline and QtSvg, which live in their own Homebrew formulae and are not where
# its rpath search looks. That is the source of the "Cannot resolve rpath" lines above.
#
# The fix is subtraction rather than another -libpath, because we do not use either
# module: nothing in ui/ imports QtQuick.Timeline or QtQuick.VectorImage, and nothing here
# loads an SVG — the logo is PNG, the menu bar mark is drawn with QPainter, and the
# .icns is handled by the system. Dropping the plugins removes the dependency *and* about
# 3 MB of dead weight from the download. If an SVG or a Timeline import is ever added,
# step 7 fails loudly rather than shipping a bundle that crashes on open.
for unused in \
    "$APP/Contents/PlugIns/quick/libqtquicktimelineplugin.dylib" \
    "$APP/Contents/PlugIns/quick/libqtquicktimelineblendtreesplugin.dylib" \
    "$APP/Contents/PlugIns/iconengines/libqsvgicon.dylib" \
    "$APP/Contents/PlugIns/imageformats/libqsvg.dylib"; do
    [ -e "$unused" ] && rm -f "$unused"
done
rm -rf "$APP/Contents/Resources/qml/QtQuick/Timeline" \
       "$APP/Contents/Resources/qml/QtQuick/VectorImage"

# macdeployqt leaves two things behind that only bite on a machine without Homebrew:
#
#   libbrotlicommon keeps its absolute install name, so everything that loads brotli —
#   including Qt's own image plugins — looks in /Users/<builder>/homebrew. Self-referential
#   and harmless-looking; the isolation run in step 7 is what exposed it.
#
#   The executable keeps an LC_RPATH pointing at Homebrew. Nothing needs it once the
#   frameworks are inside the bundle, and it is a fallback into a directory that will not
#   exist: exactly the kind of thing that turns a clean failure into a confusing one.
/usr/bin/install_name_tool -id "@rpath/libbrotlicommon.1.dylib" \
    "$APP/Contents/Frameworks/libbrotlicommon.1.dylib" 2>/dev/null || true
/usr/bin/install_name_tool -delete_rpath "$QT_PREFIX/lib" "$APP/Contents/MacOS/Jianku Screen" 2>/dev/null || true

# Nothing may point outside the bundle now. This is the check that catches a newly added
# import or a plugin macdeployqt decides to bring along next time.
stray="$(/usr/bin/find "$APP/Contents" -type f \( -name "*.dylib" -o -perm +111 \) 2>/dev/null \
    | while read -r binary; do
        /usr/bin/otool -L "$binary" 2>/dev/null | /usr/bin/grep -o "$QT_PREFIX/[^ ]*"
      done | sort -u)"
[ -z "$stray" ] || { printf '%s\n' "$stray" | /usr/bin/sed 's/^/    /' >&2; fail "仍有指向 $QT_PREFIX 的引用"; }

# QtQuick.Effects is what draws the stage shadow and the rounded corners, so its presence
# is checked by the plugin binary rather than by a string in qmldir — the qmldir names the
# plugin `effectsplugin` and the file is `libeffectsplugin.dylib`, which is exactly the
# kind of mismatch that makes a text check pass while the app still fails to load it.
[ -f "$APP/Contents/Resources/qml/QtQuick/Effects/libeffectsplugin.dylib" ] \
    || fail "QtQuick.Effects 没有部署，界面会用不了阴影和圆角"
echo "    Qt 框架 + QML 模块就位（$(du -sh "$APP" | cut -f1)），无外部引用"

echo "==> 5/7 签名应用本体"
# Framework by framework first: macdeployqt rewrote install names, which invalidated every
# nested signature, and --deep alone does not always repair them.
/usr/bin/find "$APP/Contents/Frameworks" "$APP/Contents/PlugIns" -type f \
    \( -name "*.dylib" -o -perm +111 \) 2>/dev/null | while read -r binary; do
    /usr/bin/codesign --force --sign - "$binary" 2>/dev/null || true
done
/usr/bin/codesign --force --deep --sign - "$APP" 2>/dev/null || true
/usr/bin/codesign --verify --deep "$APP" 2>/dev/null || fail "签名校验失败，应用无法启动"
echo "    签名有效"

echo "==> 6/7 生成 DMG"
rm -rf "$STAGE"
mkdir -p "$STAGE"
/bin/cp -R "$APP" "$STAGE/"
/bin/ln -s /Applications "$STAGE/Applications"
rm -f "$DMG"
/usr/bin/hdiutil create -volname "简库镜传" -srcfolder "$STAGE" -ov -format UDZO "$DMG" > /dev/null
echo "    $(du -h "$DMG" | cut -f1)  $DMG"

echo "==> 7/7 复查：挂载 DMG，用看不见 Homebrew 的环境启动一次"
# A parse of `hdiutil attach` output is brittle — the first version read the wrong column
# and reported "挂载失败" for a perfectly good image. Asking the volume to tell us where it
# is cannot drift.
MOUNT="$(/usr/bin/hdiutil attach "$DMG" -nobrowse -readonly | /usr/bin/grep -o '/Volumes/.*' | /usr/bin/head -1)"
[ -n "$MOUNT" ] || fail "DMG 挂载失败"
trap '/usr/bin/hdiutil detach "$MOUNT" > /dev/null 2>&1 || true' EXIT
MOUNTED_APP="$MOUNT/$(basename "$APP")"

run_isolated "$MOUNTED_APP/Contents/Resources/bin/ffmpeg" -hide_banner -version > /dev/null 2>&1 \
    || fail "DMG 内的 ffmpeg 不可用"
echo "    DMG 内的 ffmpeg 可用"

/usr/bin/codesign --verify --deep "$MOUNTED_APP" 2>/dev/null || fail "DMG 内签名校验失败"
echo "    DMG 内签名有效"

# The one that matters. `env -i` gives the app an empty environment, the nonexistent
# DYLD_* paths take away any fallback, and DYLD_PRINT_LIBRARIES makes every load visible:
# anything still coming from Homebrew shows up as a line in the log.
#
# The app is expected to *abort* here, and that is not a failure. It is asked for the
# offscreen platform, which this bundle does not ship — only cocoa — so Qt stops right
# after it has successfully loaded every framework, scanned every plugin and enumerated the
# platform plugins it does have. That enumeration is the proof being looked for: it cannot
# be reached if a single library failed to resolve. The second check below is what makes
# the abort meaningful instead of a crash dressed up as a pass.
LOG=/tmp/jianku-dmg-isolated.log
env -i HOME="$HOME" PATH=/usr/bin:/bin \
    DYLD_LIBRARY_PATH=/nonexistent DYLD_FALLBACK_LIBRARY_PATH=/nonexistent \
    QT_QPA_PLATFORM=offscreen DYLD_PRINT_LIBRARIES=1 \
    "$MOUNTED_APP/Contents/MacOS/Jianku Screen" > "$LOG" 2>&1 &
ISOLATED_PID=$!
sleep 8
kill "$ISOLATED_PID" 2>/dev/null || true
wait "$ISOLATED_PID" 2>/dev/null || true

if /usr/bin/grep -q "homebrew" "$LOG"; then
    /usr/bin/grep "homebrew" "$LOG" | /usr/bin/sort -u | /usr/bin/head -5 | /usr/bin/sed 's/^/    /' >&2
    fail "打包后仍从 Homebrew 加载库，换台机器会崩"
fi
/usr/bin/grep -q "Available platform plugins are" "$LOG" \
    || { /usr/bin/tail -6 "$LOG" | /usr/bin/sed 's/^/    /' >&2; fail "应用未能加载到 Qt 枚举平台插件，说明有库没解析成功"; }
# The frameworks must come from inside the mounted image. A copy that resolved to some
# other Jianku Screen.app on disk would pass the Homebrew grep and still prove nothing.
/usr/bin/grep -q "$MOUNT" "$LOG" \
    || fail "应用没有从 DMG 内部加载框架"
echo "    应用从 DMG 内部启动，未加载任何外部库"

echo
echo "完成：$DMG"
