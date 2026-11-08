import json, subprocess
from pathlib import Path
F=Path('/private/tmp/jianku-flicker-20261108')
FF='/Users/moyingxz/homebrew/bin/ffmpeg'
FFPROBE='/Users/moyingxz/homebrew/bin/ffprobe'
w,h=320,180; size=w*h*3
cap=json.loads((F/'kb-preview2.log').read_text().splitlines()[-1])
start=cap['firstSampleAtUnix']
actions=json.loads((F/'kb-preview2-actions.json').read_text())
meta=json.loads(subprocess.check_output([FFPROBE,'-v','error','-select_streams','v:0','-show_entries','frame=best_effort_timestamp_time','-of','json',str(F/'kb-preview2.mov')],text=True))['frames']
dec=subprocess.Popen([FF,'-v','error','-i',str(F/'kb-preview2.mov'),'-vf',f'scale={w}:{h}','-fps_mode','passthrough','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],stdout=subprocess.PIPE)
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
rows=[]
for i in range(1,min(len(frames),len(meta))):
    rows.append((float(meta[i]['best_effort_timestamp_time']),diff(frames[i-1],frames[i])))
play=actions['playEventUnix']-start
expected={'seg1 start/a':play+1.315,'b':play+1.815,'c':play+2.515,'seg1 end':play+2.832,'seg2 start':play+4.0,'seg2 end':play+4.6}
print('play capture-rel',round(play,2))
print('expected',{k:round(v,2) for k,v in expected.items()})
peaks=[(round(t,2),round(d,2)) for i,(t,d) in enumerate(rows) if 0<i<len(rows)-1 and d>0.15 and d>=rows[i-1][1] and d>=rows[i+1][1]]
print('peaks',peaks[:25])
for name,te in expected.items():
    win=[d for t,d in rows if abs(t-te)<=0.15]
    print(name,'max±0.15',round(max(win),3) if win else None)
