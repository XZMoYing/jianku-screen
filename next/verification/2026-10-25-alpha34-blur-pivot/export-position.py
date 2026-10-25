import json
import subprocess
import sys
from pathlib import Path
import numpy as np

if len(sys.argv) != 5:
 raise SystemExit("usage: export-position.py FFMPEG BEFORE_MP4 AFTER_MP4 OUTPUT_JSON")
ffmpeg,before_path,after_path,output_path=sys.argv[1:]
results={}
for stage,path in [('before',before_path),('after',after_path)]:
 raw=subprocess.check_output([ffmpeg,'-v','error','-i',path,'-frames:v','110','-f','rawvideo','-pix_fmt','rgb24','-'])
 frames=np.frombuffer(raw,np.uint8).reshape(-1,720,1280,3)
 data=[]
 for number in range(60,101):
  image=frames[number].astype(float)
  signal=np.median(image[120:430,:,2]-image[120:430,:,0],axis=0)
  weights=np.maximum(np.diff(signal[580:700]),0)
  positions=np.arange(580,699)+.5
  assert weights.sum()>100
  center=float((weights*positions).sum()/weights.sum())
  data.append({'frame':number,'stationaryBlueYellowEdgeX':center})
 xs=[r['stationaryBlueYellowEdgeX'] for r in data]
 results[stage]={'rows':data,'edgeRangePixels':max(xs)-min(xs),'maximumFrameStepPixels':max(abs(b-a) for a,b in zip(xs,xs[1:]))}
results['scope']='Same actual colored four-clip sample, 1280x720/60fps optimized CLI exports; tracks its static yellow-blue central edge with a median across rows to exclude animated source details. This is encoded video with compression noise, not uncompressed GPU output or screen scanout.'
Path(output_path).write_text(json.dumps(results,indent='\t')+'\n')
print({stage:{k:v for k,v in result.items() if k!='rows'} for stage,result in results.items() if isinstance(result,dict)},flush=True)

assert results['after']['edgeRangePixels'] < .5
assert results['after']['maximumFrameStepPixels'] < .2
