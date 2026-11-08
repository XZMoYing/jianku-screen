import json, subprocess
from pathlib import Path
F=Path('/private/tmp/jianku-flicker-20261108')
FF='/Users/moyingxz/homebrew/bin/ffmpeg'
FFPROBE='/Users/moyingxz/homebrew/bin/ffprobe'
w,h=320,180; size=w*h*3
cap=json.loads((F/'play-smooth.log').read_text().splitlines()[-1])
start=cap['firstSampleAtUnix']
actions=json.loads((F/'play-smooth-actions.json').read_text())
meta=json.loads(subprocess.check_output([FFPROBE,'-v','error','-select_streams','v:0','-show_entries','frame=best_effort_timestamp_time','-of','json',str(F/'play-smooth.mov')],text=True))['frames']
dec=subprocess.Popen([FF,'-v','error','-i',str(F/'play-smooth.mov'),'-vf',f'scale={w}:{h}','-fps_mode','passthrough','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],stdout=subprocess.PIPE)
frames=[]
while True:
    data=dec.stdout.read(size)
    if len(data)<size: break
    frames.append(data)
dec.wait()
def diff(a,b):
    x0,y0,x1,y1=24,25,222,112
    total=0;n=0
    for y in range(y0,y1):
        base=y*w
        for x in range(x0,x1):
            i=(base+x)*3
            total+=abs(a[i]-b[i])+abs(a[i+1]-b[i+1])+abs(a[i+2]-b[i+2]); n+=3
    return total/n if n else 0
rows=[(float(meta[i]['best_effort_timestamp_time']), diff(frames[i-1],frames[i])) for i in range(1,min(len(frames),len(meta)))]
play=actions['playEventUnix']-start; pause=actions['pauseEventUnix']-start
active=[(t,d) for t,d in rows if play<=t<=pause]
changed=[t for t,d in active if d>0.3]
print('play window',round(play,2),round(pause,2),'active frames',len(active),'changed(>0.3)',len(changed))
print('preview updates/sec',round(len(changed)/(pause-play),2))
gaps=[changed[i+1]-changed[i] for i in range(len(changed)-1)]
print('max gap(s)',round(max(gaps),3) if gaps else None,'gaps>100ms',sum(1 for g in gaps if g>0.1),'gaps>200ms',sum(1 for g in gaps if g>0.2))
allts=[float(m['best_effort_timestamp_time']) for m in meta]
intervals=[allts[i+1]-allts[i] for i in range(len(allts)-1)]
print('capture mean/p95/max ms',round(sum(intervals)/len(intervals)*1000,1),round(sorted(intervals)[int(len(intervals)*0.95)]*1000,1),round(max(intervals)*1000,1))
print('active diff mean/max',round(sum(d for _,d in active)/len(active),2),round(max(d for _,d in active),2))
