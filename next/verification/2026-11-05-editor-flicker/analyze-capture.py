import json
import subprocess
import sys
from pathlib import Path

area = Path('/private/tmp/jianku-editor-flicker-20261105')
version = sys.argv[1]
assert version in ['57', '58', '59']
source = area / f'alpha{version}-move.mov'
metadata = json.loads((area / f'alpha{version}-capture-result.json').read_text())
rect = metadata['previewRectInWindowPoints']
video = json.loads(subprocess.check_output(['/Users/moyingxz/homebrew/bin/ffprobe', '-v', 'error', '-show_entries', 'stream=width,height', '-of', 'json', str(source)], text=True))['streams'][0]
scale_x = video['width'] / metadata['bounds']['Width']
scale_y = video['height'] / metadata['bounds']['Height']
x, y, width, height = [round(value * scale) for value, scale in zip(rect, [scale_x, scale_y, scale_x, scale_y])]
crop = f'crop={width}:{height}:{x}:{y}'
ffmpeg = '/Users/moyingxz/homebrew/bin/ffmpeg'
ffprobe = '/Users/moyingxz/homebrew/bin/ffprobe'
frames = json.loads(subprocess.check_output([ffprobe, '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', str(source)], text=True))['frames']
decoder = subprocess.Popen([ffmpeg, '-v', 'error', '-i', str(source), '-vf', crop + ',scale=96:54', '-fps_mode', 'passthrough', '-enc_time_base', '1/1000000', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'], stdout=subprocess.PIPE)
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
blank = [row for row in rows if row['whiteFraction'] > .98 and row['saturatedFraction'] < .01]
runs = []
for row in blank:
    if runs and runs[-1]['endIndex'] == row['index'] - 1:
        runs[-1]['endIndex'] = row['index']
        runs[-1]['endTime'] = row['time']
        runs[-1]['frames'] += 1
    else:
        runs.append({'startIndex': row['index'], 'endIndex': row['index'], 'startTime': row['time'], 'endTime': row['time'], 'frames': 1})
report = {'version': version, 'loadingPlaceholderCandidates': runs, 'frames': len(rows), 'scope': 'all decoded frames in captured preview rectangle; metrics identify candidates, not a no-flicker acceptance', 'topChanges': sorted(rows, key=lambda row: row['meanDifference'], reverse=True)[:12], 'samples': rows}
(area / f'alpha{version}-frame-analysis.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({key: value for key, value in report.items() if key != 'samples'}, ensure_ascii=False, indent=2))
indices = sorted(set(max(0, row['index'] + offset) for row in report['topChanges'][:4] for offset in [-1, 0, 1]))
expression = '+'.join(f'eq(n,{index})' for index in indices)
output = area / f'alpha{version}-candidate-frames.png'
assert not output.exists()
subprocess.run([ffmpeg, '-v', 'error', '-i', str(source), '-vf', f'{crop},select={expression.replace(chr(44), chr(92) + chr(44))},scale=320:180,tile=4x3', '-frames:v', '1', str(output)], check=True)
(area / f'alpha{version}-candidate-indices.json').write_text(json.dumps(indices) + '\n')
