from pathlib import Path
import os,json,subprocess,time,hashlib,gzip
w=Path(__file__).parent;r=Path('/Users/moyingxz/Documents/Zzx/05_项目开发/Jianku Screen Next/next/cap');cli=r/'target/release/cap';ff='/Users/moyingxz/homebrew/bin/ffmpeg';fp='/Users/moyingxz/homebrew/bin/ffprobe'
fixture=json.loads(Path('/private/tmp/jianku-camera-shadow/zero-fixture.json').read_text())[0];project=Path(fixture['path']);assert hashlib.sha256((project/'project-config.json').read_bytes()).hexdigest()==fixture['sha256']
env=os.environ.copy();env['DYLD_LIBRARY_PATH']=str(r/'target/native-deps/lib')+':'+str(r/'target/native-deps/onnxruntime/lib')
report={'cliSha256':hashlib.sha256(cli.read_bytes()).hexdigest(),'fixture':fixture,'runs':[],'limitation':'Opt-in CPU read locks and hashing can change timing; no pixel bytes are stored.'}
previous=None;baseline_packets=json.loads(subprocess.check_output([fp,'-v','error','-select_streams','v:0','-show_packets','-show_data_hash','sha256','-show_entries','packet=pts,dts,data_hash','-of','json','/private/tmp/jianku-camera-shadow/before-camera-shadow-off.mp4']))['packets']
for i in range(1,13):
 stem=w/('run-%02d'%i);out=stem.with_suffix('.mp4');assert not out.exists();env['JIANKU_EXPORT_INPUT_TRACE']=str(stem);start=time.monotonic()
 with stem.with_suffix('.log').open('wb') as log:subprocess.run([str(cli),'--json','export',str(project),'--output',str(out),'--format','mp4','--fps','60','--resolution','1280x720','--quality','maximum'],env=env,stdout=log,stderr=subprocess.STDOUT,check=True)
 phases={phase:[json.loads(line) for line in stem.with_suffix('.'+phase+'.jsonl').read_text().splitlines()] for phase in ['producer','consumer']}
 for phase,frames in phases.items():
  assert len(frames)==540 and all(f['frame']==n and f['timelineFrame']==n and f['payload']=='surface' and (f['width'],f['height'])==(1280,720) for n,f in enumerate(frames))
 hashes={phase:[(f['ySha256'],f['uvSha256']) for f in frames] for phase,frames in phases.items()};mismatch=[n for n,(a,b) in enumerate(zip(hashes['producer'],hashes['consumer'])) if a!=b]
 packets=json.loads(subprocess.check_output([fp,'-v','error','-select_streams','v:0','-show_packets','-show_data_hash','sha256','-show_entries','packet=pts,dts,data_hash','-of','json',str(out)]))['packets'];assert len(packets)==540
 raw=subprocess.check_output([ff,'-v','error','-i',str(out),'-map','0:v:0','-f','framemd5','-']);stem.with_suffix('.framemd5.gz').write_bytes(gzip.compress(raw,mtime=0));decoded=[line.rsplit(b',',1)[1].strip().decode() for line in raw.splitlines() if not line.startswith(b'#')]
 row={'run':i,'seconds':time.monotonic()-start,'handoffMismatchFrames':mismatch,'producerChangedVsPrevious':[] if previous is None else [n for n,(a,b) in enumerate(zip(hashes['producer'],previous['producer'])) if a!=b],'packetsChangedVsPrevious':[] if previous is None else [n for n,(a,b) in enumerate(zip(packets,previous['packets'])) if a!=b],'packetsChangedVsBaseline':[n for n,(a,b) in enumerate(zip(packets,baseline_packets)) if a!=b],'decodedChangedVsPrevious':[] if previous is None else [n for n,(a,b) in enumerate(zip(decoded,previous['decoded'])) if a!=b],'surfaces':{phase:len(set(f['surfaceId'] for f in frames)) for phase,frames in phases.items()}}
 report['runs'].append(row);(w/'probe-comparison.json').write_text(json.dumps(report,indent=2)+'\n');print({k:(len(v) if isinstance(v,list) else v) for k,v in row.items()},flush=True);previous={'producer':hashes['producer'],'packets':packets,'decoded':decoded}
 if mismatch:raise SystemExit('buffer handoff mismatch')
