from pathlib import Path
import gzip,hashlib,json,os,subprocess,time
w=Path('/private/tmp/jianku-camera-shadow');r=Path('/Users/moyingxz/Documents/Zzx/05_项目开发/Jianku Screen Next/next/cap');ff='/Users/moyingxz/homebrew/bin/ffmpeg';fp='/Users/moyingxz/homebrew/bin/ffprobe'
c=json.loads((w/'zero-fixture.json').read_text())[0];project=Path(c['path']);assert hashlib.sha256((project/'project-config.json').read_bytes()).hexdigest()==c['sha256']
report={'runs':[]};frames={};pcm={}
for phase,cli,deps in [('before',Path('/Applications/Jianku Screen Next.app/Contents/MacOS/cap-cli'),None),('after',r/'target/release/cap',r/'target/native-deps')]:
 out=w/('intra-'+phase+'.mov');env=os.environ.copy()
 if deps:env['DYLD_LIBRARY_PATH']=str(deps/'lib')+':'+str(deps/'onnxruntime/lib')
 start=time.monotonic()
 if not out.exists():
  with out.with_suffix('.log').open('wb') as f:subprocess.run([str(cli),'--json','export',str(project),'--output',str(out),'--format','mov','--fps','60','--resolution','1280x720'],env=env,stdout=f,stderr=subprocess.STDOUT,check=True)
 probe=json.loads(subprocess.check_output([fp,'-v','error','-count_frames','-show_streams','-of','json',str(out)]));v=next(s for s in probe['streams'] if s['codec_type']=='video');assert (v['width'],v['height'],v['r_frame_rate'],v['nb_read_frames'])==(1280,720,'60/1','540')
 data=subprocess.check_output([ff,'-v','error','-i',str(out),'-map','0:v:0','-f','framemd5','-']);(w/('intra-'+phase+'.framemd5.gz')).write_bytes(gzip.compress(data,mtime=0));frames[phase]=[line.rsplit(b',',1)[1].strip() for line in data.splitlines() if not line.startswith(b'#')]
 pcm[phase]=hashlib.sha256(subprocess.check_output([ff,'-v','error','-i',str(out),'-map','0:a:0','-f','s16le','-'])).hexdigest() if any(s['codec_type']=='audio' for s in probe['streams']) else None
 report['runs'].append({'phase':phase,'codec':v['codec_name'],'pixelFormat':v['pix_fmt'],'frames':540,'seconds':time.monotonic()-start});(w/'intra-comparison.json').write_text(json.dumps(report,indent=2)+'\n');print(report['runs'][-1],flush=True)
report['changedFrames']=sum(a!=b for a,b in zip(frames['before'],frames['after']));report['audioStreamsMatch']=pcm['before']==pcm['after'];(w/'intra-comparison.json').write_text(json.dumps(report,indent=2)+'\n');print(report,flush=True)
assert report['changedFrames']==0 and report['audioStreamsMatch']
