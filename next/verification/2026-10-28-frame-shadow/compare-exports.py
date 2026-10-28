from pathlib import Path
import gzip
import hashlib
import json
import subprocess

work = Path('/private/tmp/jianku-frame-3d')
ffmpeg = '/Users/moyingxz/homebrew/bin/ffmpeg'
ffprobe = '/Users/moyingxz/homebrew/bin/ffprobe'

def inspect(name):
    path = work / (name + '.mp4')
    probe = json.loads(subprocess.check_output([ffprobe, '-v', 'error', '-count_frames', '-show_streams', '-of', 'json', str(path)]))
    video = next(s for s in probe['streams'] if s['codec_type'] == 'video')
    assert (video['width'], video['height'], video['r_frame_rate'], video['nb_read_frames']) == (1280, 720, '60/1', '540'), name
    frames = subprocess.check_output([ffmpeg, '-v', 'error', '-i', str(path), '-map', '0:v:0', '-f', 'framemd5', '-'])
    (work / (name + '.framemd5.gz')).write_bytes(gzip.compress(frames, mtime=0))
    hashes = [line.rsplit(b',', 1)[1].strip().decode() for line in frames.splitlines() if not line.startswith(b'#')]
    pcm = subprocess.check_output([ffmpeg, '-v', 'error', '-i', str(path), '-map', '0:a:0', '-f', 's16le', '-'])
    return {'frames': hashes, 'pcmSha256': hashlib.sha256(pcm).hexdigest(), 'pcmBytes': len(pcm), 'width':1280, 'height':720, 'fps':60}

report = {'comparisons':[], 'legacy':{}}
for case in json.loads((work / 'fixtures.json').read_text()):
    name = case['name']
    before, after = inspect('before-' + name), inspect('after-' + name)
    different = sum(a != b for a,b in zip(before['frames'], after['frames']))
    same_pcm = (before['pcmSha256'], before['pcmBytes']) == (after['pcmSha256'], after['pcmBytes'])
    assert same_pcm, name
    unchanged = name in ['flat-macos', 'shadow-off-motion']
    assert (different == 0) if unchanged else (different > 0), (name, different)
    report['comparisons'].append({'case':name, 'frames':540, 'changedFrames':different, 'pcmIdentical':same_pcm, 'pcmSha256':after['pcmSha256'], 'expectedUnchanged':unchanged})
    print(report['comparisons'][-1], flush=True)
a, b = inspect('legacy-after-legacy-none'), inspect('legacy-after-legacy-explicit')
assert a == b
report['legacy'] = {'frames':540, 'changedFrames':0, 'pcmIdentical':True, 'pcmSha256':a['pcmSha256']}
(work / 'after-comparison.json').write_text(json.dumps(report, indent=2) + '\n')
print(report['legacy'], flush=True)
for name in ['browser-light', 'browser-dark', 'browser-motion', 'stress-motion']:
    for phase in ['before', 'after']:
        subprocess.run([ffmpeg,'-v','error','-y','-i',str(work/(phase+'-'+name+'.mp4')),'-vf',"select='eq(n,0)+eq(n,180)+eq(n,300)',scale=640:360,tile=3x1",'-frames:v','1',str(work/(phase+'-'+name+'-contact.png'))],check=True)
