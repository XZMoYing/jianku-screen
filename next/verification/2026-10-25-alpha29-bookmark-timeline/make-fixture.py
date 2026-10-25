import argparse
import json
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('destination', type=Path)
parser.add_argument('--ffmpeg', default='ffmpeg')
args = parser.parse_args()
project = args.destination
if project.exists():
    raise SystemExit('Refusing to replace an existing project')
(project / 'content').mkdir(parents=True)
subprocess.run([
    args.ffmpeg, '-v', 'error', '-f', 'lavfi', '-i',
    'testsrc2=size=640x360:rate=60:duration=12', '-c:v', 'libx264',
    '-preset', 'fast', '-pix_fmt', 'yuv420p', str(project / 'content/display.mp4')
], check=True)
source = {'display': {'path': 'content/display.mp4', 'fps': 60, 'start_time': 0.0}}
meta = {'platform': 'MacOS', 'pretty_name': '书签合成回归', 'sharing': None,
        'segments': [source, source], 'cursors': {}, 'status': {'status': 'Complete'}}
config = {'aspectRatio': None, 'background': {
    'source': {'type': 'color', 'value': [236, 231, 216]}, 'padding': 10, 'rounding': 7.5
}, 'camera': {'hide': True}, 'timeline': {'segments': [
    {'recordingSegment': 0, 'start': 4, 'end': 8, 'timescale': 2},
    {'recordingSegment': 0, 'start': 0, 'end': 4, 'timescale': 1},
    {'recordingSegment': 0, 'start': 4, 'end': 6, 'timescale': 1},
    {'recordingSegment': 1, 'start': 0, 'end': 1, 'timescale': 1},
], 'zoomSegments': []}}
bookmarks = [{'id': f'fixture-{index}', 'label': label, 'recordingSegment': 0, 'time': time}
             for index, (label, time) in enumerate([
                 ('开场', 0), ('紧邻', 0.01), ('操作', 2), ('重复使用', 5.5), ('已剪除', 10)
             ])]
for name, value in [('recording-meta.json', meta), ('project-config.json', config),
                    ('recording-bookmarks.json', bookmarks)]:
    (project / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
print(project)
