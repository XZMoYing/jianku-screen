import json
import plistlib
import subprocess
import time
from pathlib import Path

app = Path('/Users/moyingxz/Documents/Zzx/05_项目开发/Jianku Screen Next Builds/0.2.0-alpha.56/Jianku Screen Next.app')
area = Path('/private/tmp/jianku-alpha56-20261103')
exporter = app / 'Contents/MacOS/cap-exporter'
ffprobe = '/Users/moyingxz/homebrew/bin/ffprobe'
matrix = json.loads((area / 'fixtures.json').read_text())
durations = {'按键拖动': 16, '3D拖动': 16}
info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
assert info['CFBundleShortVersionString'] == '0.2.0-alpha.56'
results = []
for case in matrix:
    name = case['case']
    project = Path(case['path'])
    config = json.loads((project / 'project-config.json').read_text())
    actual = [[round(segment['start'], 6), round(segment['end'], 6)]
              for segment in config['timeline']['zoomSegments']]
    assert actual == [], name
    output = area / f'{name}-验收.mp4'
    assert not output.exists(), 'Refuse to overwrite an export'
    log_path = area / f'export-{name}.log'
    started = time.monotonic()
    with log_path.open('w') as log:
        exported = subprocess.run(
            [str(exporter), 'export', str(project), '--output', str(output),
             '--fps', '30', '--resolution', '1280x720', '--quality', 'maximum', '--json'],
            stdout=log, stderr=subprocess.STDOUT, timeout=180)
    elapsed = time.monotonic() - started
    log = log_path.read_text()
    assert exported.returncode == 0 and '"type":"Completed"' in log, name
    assert 'ERROR' not in log, name
    probed = subprocess.run(
        [ffprobe, '-v', 'error', '-count_frames', '-show_entries',
         'stream=index,codec_name,width,height,nb_read_frames:format=duration,size',
         '-of', 'json', str(output)], capture_output=True, text=True, check=True)
    assert not probed.stderr.strip(), probed.stderr
    media = json.loads(probed.stdout)
    video = next(stream for stream in media['streams'] if 'width' in stream)
    assert video['codec_name'] == 'h264'
    assert video['width'] == 1280 and video['height'] == 720
    assert int(video['nb_read_frames']) == durations[name] * 30
    assert abs(float(media['format']['duration']) - durations[name]) < 0.05
    row = {'case': name, 'passed': True, 'path': str(output), 'media': media,
           'exportElapsedSeconds': round(elapsed, 3),
           'scope': 'export completion and actual full decode; not color/performance acceptance'}
    results.append(row)
    (area / 'export-results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(row, ensure_ascii=False), flush=True)
