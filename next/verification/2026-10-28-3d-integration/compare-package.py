from pathlib import Path
import gzip,hashlib,json,subprocess
p=Path('/private/tmp/jianku-3d-integration');ffmpeg='/Users/moyingxz/homebrew/bin/ffmpeg';ffprobe='/Users/moyingxz/homebrew/bin/ffprobe'
pairs=[('ui-and-packaged-cli',p/'gui-export.mp4',p/'package-ui.mp4'),('packaged-split-and-component',p/'package-offgrid.mp4',p/'after-offgrid-60.mp4'),('ordinary-zoom-preserved',p/'package-flat.mp4',Path('/private/tmp/jianku-3d-spring/fixtures/after-flat.mp4'))]
cache={}
def decode(path):
 if path in cache:return cache[path]
 raw=subprocess.check_output([ffmpeg,'-v','error','-i',str(path),'-map','0:v:0','-f','framemd5','-'])
 frames=[line.rsplit(',',1)[1].strip() for line in raw.decode().splitlines() if line and not line.startswith('#')]
 pcm=subprocess.check_output([ffmpeg,'-v','error','-i',str(path),'-map','0:a:0','-f','f32le','-ar','48000','-ac','2','-'])
 probe=json.loads(subprocess.check_output([ffprobe,'-v','error','-show_entries','stream=codec_name,width,height,nb_frames,r_frame_rate','-show_entries','format=duration','-of','json',str(path)]))
 with gzip.open(p/(path.stem+'-package.framemd5.gz'),'wb') as f:f.write(raw)
 cache[path]={'frames':frames,'pcmSha256':hashlib.sha256(pcm).hexdigest(),'movieSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'probe':probe}
 return cache[path]
report={'checks':[],'passed':True}
for name,a,b in pairs:
 left,right=decode(a),decode(b)
 assert len(left['frames'])==len(right['frames'])==540
 changed=[i for i,(x,y) in enumerate(zip(left['frames'],right['frames'])) if x!=y]
 same_audio=left['pcmSha256']==right['pcmSha256']
 check={'case':name,'frames':540,'changedFrames':changed,'samePcm':same_audio,'passed':not changed and same_audio,'left':str(a),'right':str(b)}
 report['checks'].append(check);report['passed']=report['passed'] and check['passed'];print(json.dumps(check),flush=True)
report['media']={str(path):{k:v for k,v in value.items() if k!='frames'} for path,value in cache.items()}
(p/'package-comparison.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
if not report['passed']:raise SystemExit(1)
