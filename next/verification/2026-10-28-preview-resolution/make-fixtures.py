import argparse
import json
from pathlib import Path
import shutil
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--source', type=Path, required=True)
parser.add_argument('--directory', type=Path, required=True)
parser.add_argument('--ffmpeg', default='ffmpeg')
args = parser.parse_args()
marker = json.loads((args.source / '.jianku-3d-integration-fixture.json').read_text())
if marker != {'kind': 'jianku-3d-integration', 'version': 1} or args.directory.exists():
    raise SystemExit('Only owned synthetic sources and a new destination are accepted')
args.directory.mkdir(parents=True)
for name in ['small', 'large']:
    project = args.directory / (name + '.jks')
    shutil.copytree(args.source, project)
    (project / '.jianku-preview-resolution-fixture.json').write_text(json.dumps({'kind': 'jianku-preview-resolution', 'version': 1}) + '\n')
    path = project / 'recording-meta.json'
    meta = json.loads(path.read_text())
    meta['pretty_name'] = '预览清晰度验收 · ' + name
    if name == 'large':
        for segment in meta['segments']:
            segment['display']['path'] = 'content/resolution-4k.mp4'
    path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n')
subprocess.run([
    args.ffmpeg, '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=60',
    '-t', '9', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-threads', '2', str(args.directory / 'large.jks/content/resolution-4k.mp4'),
], check=True)
