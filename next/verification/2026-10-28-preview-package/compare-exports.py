import argparse
import gzip
import hashlib
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('left', type=Path)
parser.add_argument('right', type=Path)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
if args.output.exists():
    raise SystemExit('Existing evidence is not replaced')
ffmpeg = '/Users/moyingxz/homebrew/bin/ffmpeg'
ffprobe = '/Users/moyingxz/homebrew/bin/ffprobe'

def decode(path):
    probe = json.loads(subprocess.check_output([ffprobe, '-v', 'error', '-show_entries', 'stream=codec_name,codec_type,width,height,nb_frames,r_frame_rate', '-show_entries', 'format=duration', '-of', 'json', str(path)]))
    video = next(s for s in probe['streams'] if s['codec_type'] == 'video')
    assert (video['width'], video['height'], video['r_frame_rate']) == (1280, 720, '60/1'), video
    hashes = subprocess.check_output([ffmpeg, '-v', 'error', '-i', str(path), '-map', '0:v:0', '-f', 'framemd5', '-'])
    frames = [line.rsplit(',', 1)[1].strip() for line in hashes.decode().splitlines() if line and not line.startswith('#')]
    assert len(frames) == 540, len(frames)
    pcm = subprocess.check_output([ffmpeg, '-v', 'error', '-i', str(path), '-map', '0:a:0', '-f', 'f32le', '-ar', '48000', '-ac', '2', '-'])
    with gzip.open(args.output.parent/(path.stem+'.framemd5.gz'), 'wb') as stream:
        stream.write(hashes)
    return {'path': str(path), 'movieSha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'probe': probe, 'pcmSha256': hashlib.sha256(pcm).hexdigest(), 'pcmBytes': len(pcm)}, frames

left, a = decode(args.left)
right, b = decode(args.right)
changed = [index for index, (x, y) in enumerate(zip(a, b)) if x != y]
report = {'left': left, 'right': right, 'framesCompared': 540, 'changedFrames': changed, 'samePcm': left['pcmSha256'] == right['pcmSha256'], 'passed': not changed and left['pcmSha256'] == right['pcmSha256']}
args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
print(json.dumps(report, ensure_ascii=False))
if not report['passed']:
    raise SystemExit(1)
