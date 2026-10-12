import argparse
import hashlib
import json
import math
import shutil
import struct
import subprocess
import wave
import zlib
from pathlib import Path

EVIDENCE = Path(__file__).resolve().parent
BASE = EVIDENCE.parent / '2026-10-12-native-foundation/fixture.cap'
TRIAL = Path.home() / 'Movies/Jianku Screen Next/试用 0.2.0-alpha.6'
SOURCE = TRIAL / '复制验证源.cap'
EXTERNAL = TRIAL / '外部测试素材'
MOVED = TRIAL / '移动后/可携带工程.cap'
FFMPEG = Path.home() / 'homebrew/bin/ffmpeg'
FFPROBE = Path.home() / 'homebrew/bin/ffprobe'


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def png(path, width, height, badge=False):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    pixels = bytearray()
    for y in range(height):
        pixels.append(0)
        for x in range(width):
            pixels.extend((239, 79, 107, 230) if badge else (int(70 + 75 * x / width), int(90 + 35 * y / height), int(180 + 35 * x / width), 255))
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(pixels)) + chunk(b'IEND', b''))


def export(executable, project, name):
    output = TRIAL / f'{name}.mp4'
    with (EVIDENCE / f'{name}-export.jsonl').open('w') as stdout, (EVIDENCE / f'{name}-export.stderr').open('w') as stderr:
        subprocess.run([str(executable), 'export', str(project), str(output), '--fps', '60', '--resolution', '1280x800', '--quality', 'maximum', '--json'], stdout=stdout, stderr=stderr, check=True, timeout=180)
    terminal = json.loads((EVIDENCE / f'{name}-export.jsonl').read_text().splitlines()[-1])
    assert terminal['type'] == 'Completed', terminal
    probe = json.loads(subprocess.check_output([str(FFPROBE), '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(output)]))
    write_json(EVIDENCE / f'{name}-probe.json', probe)
    video = next(stream for stream in probe['streams'] if stream['codec_type'] == 'video')
    assert video['nb_frames'] == '360' and video['r_frame_rate'] == '60/1', video
    assert (video['width'], video['height']) == (1280, 800), video
    assert any(stream['codec_type'] == 'audio' for stream in probe['streams'])
    with (EVIDENCE / f'{name}-decode.log').open('w') as stderr:
        subprocess.run([str(FFMPEG), '-v', 'error', '-i', str(output), '-f', 'null', '-'], stderr=stderr, check=True, timeout=60)
    with (EVIDENCE / f'{name}-frames.md5').open('w') as stdout:
        subprocess.run([str(FFMPEG), '-v', 'error', '-i', str(output), '-map', '0:v:0', '-pix_fmt', 'rgba', '-f', 'framemd5', '-'], stdout=stdout, check=True, timeout=60)
    return output


def rows(name):
    return [line for line in (EVIDENCE / f'{name}-frames.md5').read_text().splitlines() if line and not line.startswith('#')]


def prepare(executable):
    TRIAL.mkdir(parents=True, exist_ok=True)
    assert not SOURCE.exists() and not EXTERNAL.exists() and not MOVED.exists(), 'Use a fresh phase trial directory'
    shutil.copytree(BASE, SOURCE)
    EXTERNAL.mkdir()
    png(EXTERNAL / '自建背景.png', 1280, 800)
    png(EXTERNAL / '自建贴图.png', 64, 64, True)
    with wave.open(str(EXTERNAL / '自建音频.wav'), 'wb') as audio:
        audio.setparams((1, 2, 48000, 0, 'NONE', 'not compressed'))
        audio.writeframes(b''.join(struct.pack('<h', round(1800 * math.sin(2 * math.pi * 220 * sample / 48000))) for sample in range(6 * 48000)))
    config = json.loads((SOURCE / 'project-config.json').read_text())
    config['background']['source'] = {'type': 'image', 'path': str(EXTERNAL / '自建背景.png')}
    config['timeline']['styleSegments'] = [{'start': 2.0, 'end': 4.0, 'name': '自建背景样式', 'overrides': {'background': config['background']}}]
    config['timeline']['imageSegments'] = [{'start': 0.5, 'end': 5.5, 'path': str(EXTERNAL / '自建贴图.png'), 'name': '自建贴图', 'center': {'x': 0.8, 'y': 0.85}, 'size': {'x': 0.05, 'y': 0.08}, 'rotation': 0.2}]
    config['timeline']['audioSegments'] = [{'start': 0, 'end': 6.0, 'path': str(EXTERNAL / '自建音频.wav'), 'name': '自建音频', 'fadeIn': 0.3, 'fadeOut': 0.4, 'volumeDb': -6}]
    write_json(SOURCE / 'project-config.json', config)
    export(executable, SOURCE, 'alpha5-原工程')
    write_json(EVIDENCE / 'source-snapshot.json', {str(path.relative_to(SOURCE)): digest(path) for path in SOURCE.rglob('*') if path.is_file()})
    write_json(EVIDENCE / 'fixture-manifest.json', {'synthetic': True, 'base': str(BASE), 'source': str(SOURCE), 'externalAssets': {path.name: digest(path) for path in EXTERNAL.iterdir()}, 'userCaptureOrWallpaper': False})


def verify(executable):
    export(executable, SOURCE, 'alpha6-原工程')
    before = {str(path.relative_to(SOURCE)): digest(path) for path in SOURCE.rglob('*') if path.is_file()}
    destination = TRIAL / '便携副本.cap'
    copied = subprocess.run([str(executable), 'project', 'copy', str(SOURCE), str(destination), '--json'], check=True, capture_output=True, text=True, timeout=120)
    report = json.loads(copied.stdout)
    write_json(EVIDENCE / 'copy-report.json', report)
    assert report['embeddedAssets'] == 3, report
    after = {str(path.relative_to(SOURCE)): digest(path) for path in SOURCE.rglob('*') if path.is_file()}
    assert before == after, 'Copy altered source files'
    copy_before = {str(path.relative_to(destination)): digest(path) for path in destination.rglob('*') if path.is_file()}
    rejected = subprocess.run([str(executable), 'project', 'copy', str(SOURCE), str(destination), '--json'], capture_output=True, text=True, timeout=120)
    assert rejected.returncode != 0
    assert copy_before == {str(path.relative_to(destination)): digest(path) for path in destination.rglob('*') if path.is_file()}
    write_json(EVIDENCE / 'existing-destination-check.json', {'exitCode': rejected.returncode, 'stderr': rejected.stderr, 'stdout': rejected.stdout, 'sourceUnchanged': before == after, 'destinationUnchanged': True})
    config = json.loads((destination / 'project-config.json').read_text())
    paths = [config['background']['source']['path'], config['timeline']['styleSegments'][0]['overrides']['background']['source']['path'], config['timeline']['imageSegments'][0]['path'], config['timeline']['audioSegments'][0]['path']]
    assert all(not Path(path).is_absolute() and (destination / path).is_file() for path in paths)
    assert paths[0] == paths[1]
    MOVED.parent.mkdir(parents=True, exist_ok=True)
    destination.rename(MOVED)
    assert SOURCE.parent == TRIAL and EXTERNAL.parent == TRIAL
    shutil.rmtree(SOURCE)
    shutil.rmtree(EXTERNAL)
    validation = subprocess.run([str(executable), 'project', 'validate', str(MOVED), '--json'], check=True, capture_output=True, text=True, timeout=30)
    write_json(EVIDENCE / 'moved-project-validation.json', json.loads(validation.stdout))
    export(executable, MOVED, 'alpha6-移动副本')
    baseline = rows('alpha5-原工程')
    current = rows('alpha6-原工程')
    moved = rows('alpha6-移动副本')
    assert len(baseline) == len(current) == len(moved) == 360
    summary = {'frames': 360, 'fps': 60, 'resolution': [1280, 800], 'oldVsNewIdenticalRGBAAndTimestamps': baseline == current, 'originalVsMovedIdenticalRGBAAndTimestamps': current == moved, 'sourceUnchangedByCopy': before == after, 'externalAssetsEmbedded': report['embeddedAssets'], 'originalAndExternalRemovedBeforeMovedExport': not SOURCE.exists() and not EXTERNAL.exists(), 'relativeBackgroundAndStylePaths': paths[0] == paths[1], 'output': str(MOVED), 'sourceHashBeforeCopy': before}
    write_json(EVIDENCE / 'portable-export-comparison.json', summary)
    assert baseline == current == moved, summary
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('stage', choices=['prepare', 'verify'])
    parser.add_argument('executable', type=Path)
    args = parser.parse_args()
    (prepare if args.stage == 'prepare' else verify)(args.executable)
