import json, subprocess
from pathlib import Path
F=Path('/private/tmp/jianku-flicker-20261108')
FF='/Users/moyingxz/homebrew/bin/ffmpeg'
FFPROBE='/Users/moyingxz/homebrew/bin/ffprobe'
w,h=320,180; size=w*h*3
cap=json.loads((F/'kb-preview.log').read_text().splitlines()[-1])
start=cap['firstSampleAtUnix']
actions=json.loads((F/'kb-preview-actions.json').read_text())
meta=json.loads(subprocess.check_output([FFPROBE,'-v','error','-select_streams','v:0','-show_entries','frame=best_effort_timestamp_time','-of','json',str(F/'kb-preview.mov')],text=True))['frames']
dec=subprocess.Popen([FF,'-v','error','-i',str(F/'kb-preview.mov'),'-vf',f'scale={w}:{h}','-fps_mode','passthrough','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],stdout=subprocess.PIPE)
frames=[]
while True:
    data=dec.stdout.read(size)
    if len(data)<size: break
    frames.append(data)
dec.wait()
def region_diff(a,b):
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
    t=float(meta[i]['best_effort_timestamp_time'])
    rows.append((t,region_diff(frames[i-1],frames[i])))
play_start=actions['playBefore']-start
expected={'a/seg1 start':play_start+1.315,'b':play_start+1.815,'c':play_start+2.515,'seg1 end':play_start+2.832,'seg2 start':play_start+4.0,'seg2 end':play_start+4.6}
print('play_start capture-rel',round(play_start,2))
print('expected capture-rel',{k:round(v,2) for k,v in expected.items()})
# peaks: local maxima above 0.25
peaks=[]
for i in range(1,len(rows)-1):
    t,d=rows[i]
    if d>0.25 and d>=rows[i-1][1] and d>=rows[i+1][1]:
        peaks.append((round(t,2),round(d,2)))
print('peaks',peaks[:20])
# for each expected find max diff within +-0.15
for name,te in expected.items():
    window=[d for t,d in rows if abs(t-te)<=0.18]
    print(name,'max in window',round(max(window),2) if window else None)
