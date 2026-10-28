from pathlib import Path
import gzip,hashlib,json,subprocess
w=Path('/private/tmp/jianku-camera-shadow');ff='/Users/moyingxz/homebrew/bin/ffmpeg';fp='/Users/moyingxz/homebrew/bin/ffprobe'
base={r['case']:r for r in json.loads((w/'before-media.json').read_text())}
unchanged={'camera-only-motion','camera-shadow-off','flat-camera','hidden-camera','focus-blur-only'}
report=[]
violations=[]
for c in json.loads((w/'all-fixtures.json').read_text()):
 n=c['name']
 before_prefix='before-padded-' if n=='camera-only-padded-motion' else 'before-extra-' if n in {'macbook-camera','scene-transition-padded'} else 'before-'
 before=w/(before_prefix+n+'.mp4');after=w/('after-'+n+'.mp4')
 def probe(p):
  s=next(s for s in json.loads(subprocess.check_output([fp,'-v','error','-count_frames','-show_streams','-of','json',str(p)]))['streams'] if s['codec_type']=='video')
  assert (s['width'],s['height'],s['r_frame_rate'],s['nb_read_frames'])==(1280,720,'60/1','540'),n
 def hashes(p):
  target=w/(p.stem+'.framemd5.gz')
  if not target.exists():
   data=subprocess.check_output([ff,'-v','error','-i',str(p),'-map','0:v:0','-f','framemd5','-']);target.write_bytes(gzip.compress(data,mtime=0))
  else:data=gzip.decompress(target.read_bytes())
  return [line.rsplit(b',',1)[1].strip() for line in data.splitlines() if not line.startswith(b'#')]
 probe(before);probe(after);a,b=hashes(before),hashes(after);assert len(a)==len(b)==540
 count=sum(x!=y for x,y in zip(a,b))
 if not ((count==0) if n in unchanged else (count>0)):violations.append({'case':n,'changedFrames':count})
 def pcm(p):return hashlib.sha256(subprocess.check_output([ff,'-v','error','-i',str(p),'-map','0:a:0','-f','s16le','-'])).hexdigest()
 pcm_before,pcm_after=pcm(before),pcm(after);assert pcm_before==pcm_after,n
 report.append({'case':n,'frames':540,'changedFrames':count,'expectedUnchanged':n in unchanged,'pcmIdentical':True,'pcmSha256':pcm_after})
 (w/'after-comparison.json').write_text(json.dumps(report,indent=2)+'\n');print(report[-1],flush=True)
 if n not in unchanged:
  for phase,path in [('before',before),('after',after)]:
   subprocess.run([ff,'-v','error','-y','-i',str(path),'-vf',"select='eq(n,90)+eq(n,180)+eq(n,330)',scale=640:360,tile=3x1",'-frames:v','1',str(w/(phase+'-'+n+'-contact.png'))],check=True)
(w/'comparison-violations.json').write_text(json.dumps(violations,indent=2)+'\n')
assert not violations,violations
print('all 10 camera composition cases compared',flush=True)
