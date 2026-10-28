from pathlib import Path
import gzip,hashlib,json,subprocess,time
w=Path('/private/tmp/jianku-frame-3d')
a=Path('/Applications/Jianku Screen Next.app/Contents/MacOS/cap-cli')
ff='/Users/moyingxz/homebrew/bin/ffmpeg'
fp='/Users/moyingxz/homebrew/bin/ffprobe'
fixtures=json.loads((w/'fixtures.json').read_text())
report={'runs':[],'comparisons':[]}
for name in ['browser-motion','stress-motion','flat-macos']:
 case=next(c for c in fixtures if c['name']==name)
 p=Path(case['path']);assert hashlib.sha256((p/'project-config.json').read_bytes()).hexdigest()==case['sha256']
 out=w/('package45-'+name+'.mp4');assert not out.exists()
 start=time.monotonic()
 with out.with_suffix('.log').open('wb') as f:subprocess.run([str(a),'--json','export',str(p),'--output',str(out),'--format','mp4','--fps','60','--resolution','1280x720','--quality','maximum'],stdout=f,stderr=subprocess.STDOUT,check=True)
 md5=subprocess.check_output([ff,'-v','error','-i',str(out),'-map','0:v:0','-f','framemd5','-'])
 (w/(out.stem+'.framemd5.gz')).write_bytes(gzip.compress(md5,mtime=0))
 rows=lambda data:[l.rsplit(b',',1)[1].strip() for l in data.splitlines() if not l.startswith(b'#')]
 expected=rows(gzip.decompress((w/('after-'+name+'.framemd5.gz')).read_bytes()))
 actual=rows(md5);assert len(actual)==540 and actual==expected,name
 pcm=subprocess.check_output([ff,'-v','error','-i',str(out),'-map','0:a:0','-f','s16le','-'])
 assert hashlib.sha256(pcm).hexdigest()=='23c93e2b82a6c4c11af9d52c2330afa51a32f65707ca6c8144e99b4c3ad02885'
 report['comparisons'].append({'case':name,'frames':540,'changedFrames':0,'pcmIdentical':True,'seconds':time.monotonic()-start})
 (w/'package45-checks.json').write_text(json.dumps(report,indent=2)+'\n')
 print(report['comparisons'][-1],flush=True)
p=Path('/Users/moyingxz/Documents/Zzx/05_项目开发/Jianku Screen Next Builds/0.2.0-alpha.45/浏览器外框与自然运镜示例.jks')
for resolution in ['1280x720','3840x2160']:
 out=w/('package45-demo-'+resolution+'.mp4');assert not out.exists()
 start=time.monotonic()
 with out.with_suffix('.log').open('wb') as f:subprocess.run([str(a),'--json','export',str(p),'--output',str(out),'--format','mp4','--fps','60','--resolution',resolution,'--quality','maximum'],stdout=f,stderr=subprocess.STDOUT,check=True)
 video=next(s for s in json.loads(subprocess.check_output([fp,'-v','error','-count_frames','-show_streams','-of','json',str(out)]))['streams'] if s['codec_type']=='video')
 assert (f"{video['width']}x{video['height']}",video['r_frame_rate'],video['nb_read_frames'])==(resolution,'60/1','540')
 report['runs'].append({'case':'neutral-demo','resolution':resolution,'fps':60,'frames':540,'seconds':time.monotonic()-start})
 (w/'package45-checks.json').write_text(json.dumps(report,indent=2)+'\n')
 print(report['runs'][-1],flush=True)
subprocess.run([ff,'-v','error','-y','-i',str(w/'package45-demo-1280x720.mp4'),'-vf',"select='eq(n,0)+eq(n,180)+eq(n,300)',scale=640:360,tile=3x1",'-frames:v','1',str(w/'package45-demo-contact.png')],check=True)
