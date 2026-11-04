import json
import subprocess
from pathlib import Path

area = Path('/private/tmp/jianku-alpha57-20261104/flicker')
source = area / 'three-d-body-owned-window.mp4'
ffmpeg = '/Users/moyingxz/homebrew/bin/ffmpeg'
ffprobe = '/Users/moyingxz/homebrew/bin/ffprobe'
frames = json.loads(subprocess.check_output([ffprobe, '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', str(source)], text=True))['frames']
decoder = subprocess.Popen([ffmpeg, '-v', 'error', '-i', str(source), '-vf', 'crop=980:550:284:246,scale=96:54', '-fps_mode', 'passthrough', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'], stdout=subprocess.PIPE)
rows = []
previous = None
size = 96 * 54 * 3
for index, frame in enumerate(frames):
    data = decoder.stdout.read(size)
    assert len(data) == size
    pixels = list(zip(data[::3], data[1::3], data[2::3]))
    count = len(pixels)
    row = {'index': index, 'time': float(frame['best_effort_timestamp_time']), 'meanDifference': sum(abs(a - b) for a, b in zip(data, previous)) / size if previous else 0, 'saturatedFraction': sum(max(pixel) - min(pixel) > 100 for pixel in pixels) / count, 'whiteFraction': sum(min(pixel) > 235 for pixel in pixels) / count, 'blackFraction': sum(max(pixel) < 20 for pixel in pixels) / count}
    rows.append(row)
    previous = data
assert decoder.stdout.read(1) == b'' and decoder.wait() == 0
report = {'frames': len(rows), 'scope': 'all decoded frames in captured preview rectangle; metrics identify candidates, not a no-flicker acceptance', 'topChanges': sorted(rows, key=lambda row: row['meanDifference'], reverse=True)[:12], 'samples': rows}
(area / 'frame-analysis.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({key: value for key, value in report.items() if key != 'samples'}, ensure_ascii=False, indent=2))
indices = sorted(set(max(0, row['index'] + offset) for row in report['topChanges'][:4] for offset in [-1, 0, 1]))
expression = '+'.join(f'eq(n,{index})' for index in indices)
output = area / 'candidate-frames.png'
assert not output.exists()
subprocess.run([ffmpeg, '-v', 'error', '-i', str(source), '-vf', f'crop=980:550:284:246,select={expression.replace(chr(44), chr(92) + chr(44))},scale=320:180,tile=4x3', '-frames:v', '1', str(output)], check=True)
(area / 'candidate-indices.json').write_text(json.dumps(indices) + '\n')
