from pathlib import Path
import gzip,json,subprocess
w=Path('/private/tmp/jianku-camera-shadow');ff='/Users/moyingxz/homebrew/bin/ffmpeg'
def hashes(p):return [l.rsplit(b',',1)[1].strip() for l in gzip.decompress(p.read_bytes()).splitlines() if not l.startswith(b'#')]
a=hashes(w/'before-camera-shadow-off.framemd5.gz');b=hashes(w/'after-camera-shadow-off.framemd5.gz');changed=[i for i,(x,y) in enumerate(zip(a,b)) if x!=y]
index=changed[0];raw=[]
for phase in ['before','after']:
 p=w/(phase+'-camera-shadow-off.mp4')
 pixels=subprocess.check_output([ff,'-v','error','-i',str(p),'-vf',f"select='eq(n,{index})'",'-fps_mode','passthrough','-frames:v','1','-f','rawvideo','-pix_fmt','rgba','-'])
 assert len(pixels)==1280*720*4;raw.append(pixels)
 subprocess.run([ff,'-v','error','-y','-f','rawvideo','-pix_fmt','rgba','-video_size','1280x720','-i','-','-frames:v','1',str(w/(phase+'-zero-diff.png'))],input=pixels,check=True)
xs=[];ys=[];count=0;maximum=0;examples=[]
for i in range(0,len(raw[0]),4):
 x,y=(i//4)%1280,(i//4)//1280
 p,q=raw[0][i:i+4],raw[1][i:i+4]
 if p!=q:
  count+=1;xs.append(x);ys.append(y);maximum=max(maximum,max(abs(a-b) for a,b in zip(p,q)))
  if len(examples)<12:examples.append({'x':x,'y':y,'before':list(p),'after':list(q)})
report={'changedFrames':len(changed),'firstChanged':changed[:20],'lastChanged':changed[-10:],'sampleFrame':index,'changedPixels':count,'maxByteDifference':maximum,'bounds':[min(xs),min(ys),max(xs),max(ys)],'examples':examples}
(w/'zero-shadow-diagnostic.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
