from pathlib import Path
import json,subprocess,time,os,hashlib,gzip
w=Path(__file__).parent;cli=Path('/Applications/Jianku Screen Next.app/Contents/MacOS/cap-cli');ff='/Users/moyingxz/homebrew/bin/ffmpeg';env=os.environ.copy();env.pop('DYLD_INSERT_LIBRARIES',None);env.pop('JIANKU_EXPORT_INPUT_TRACE',None);env.pop('JIANKU_SYNTHETIC_NV12_CAPTURE',None)
fixture=json.loads(Path('/private/tmp/jianku-camera-shadow/zero-fixture.json').read_text())[0]
def decoded(path):
 raw=subprocess.check_output([ff,'-v','error','-i',str(path),'-map','0:v:0','-f','framemd5','-']);return raw,[line.rsplit(b',',1)[1].strip().decode() for line in raw.splitlines() if not line.startswith(b'#')]
baseline=decoded(w/'run-01.mp4')[1];report={'cliSha256':hashlib.sha256(cli.read_bytes()).hexdigest(),'installedVersion':'0.2.0-alpha.45','mode':'unmodified installed binary; no input interposer or trace','runs':[]}
for i in range(1,13):
 out=w/('old-%02d.mp4'%i);assert not out.exists();start=time.monotonic()
 with out.with_suffix('.log').open('wb') as log:subprocess.run([str(cli),'--json','export',fixture['path'],'--output',str(out),'--format','mp4','--fps','60','--resolution','1280x720','--quality','maximum'],stdout=log,stderr=subprocess.STDOUT,env=env,check=True)
 raw,frames=decoded(out);assert len(frames)==540;out.with_suffix('.framemd5.gz').write_bytes(gzip.compress(raw,mtime=0))
 row={'run':i,'seconds':time.monotonic()-start,'changedDecodedFrames':[n for n,(a,b) in enumerate(zip(frames,baseline)) if a!=b]};report['runs'].append(row);(w/'old-comparison.json').write_text(json.dumps(report,indent=2)+'\n');print({k:len(v) if isinstance(v,list) else v for k,v in row.items()},flush=True)
