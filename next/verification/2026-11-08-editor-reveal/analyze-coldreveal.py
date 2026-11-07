import json, subprocess
from pathlib import Path
F=Path('/private/tmp/jianku-flicker-20261108')
FFMPEG='/Users/moyingxz/homebrew/bin/ffmpeg'
FFPROBE='/Users/moyingxz/homebrew/bin/ffprobe'
W,H=96,54
movie=F/'coldreveal.mov'
meta=json.loads(subprocess.check_output([FFPROBE,'-v','error','-select_streams','v:0','-show_entries','frame=best_effort_timestamp_time','-of','json',str(movie)],text=True))['frames']
dec=subprocess.Popen([FFMPEG,'-v','error','-i',str(movie),'-vf',f'scale={W}:{H}','-fps_mode','passthrough','-enc_time_base','1/1000000','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],stdout=subprocess.PIPE)
size=W*H*3
frames=[]
for frame in meta:
    data=dec.stdout.read(size)
    assert len(data)==size
    frames.append((float(frame['best_effort_timestamp_time']),data))
assert dec.stdout.read(1)==b'' and dec.wait()==0
ref=frames[-1][1]
rows=[]
prev=None
for t,data in frames:
    n=len(data)
    changed=sum(1 for a,b in zip(data,ref) if abs(a-b)>25)/n
    diff=sum(abs(a-b) for a,b in zip(data,prev))/n if prev else 0
    luma=sum(data)/n
    # uniformity: stddev of sampled pixels
    px=[data[i] for i in range(0,n,3)]
    mean=sum(px)/len(px)
    var=sum((v-mean)**2 for v in px)/len(px)
    rows.append({'t':round(t,3),'changedVsLoaded':round(changed,4),'diff':round(diff,3),'luma':round(luma,1),'std':round(var**0.5,1)})
    prev=data
summary={'frames':len(rows),'duration':rows[-1]['t'],
 'first8':rows[:8],
 'changedMax':max(r['changedVsLoaded'] for r in rows),
 'firstStableTime':next((r['t'] for r in rows if r['changedVsLoaded']<0.02), None),
 'lumaRange':[min(r['luma'] for r in rows),max(r['luma'] for r in rows)],
 'stdFirst':rows[0]['std'],'stdMax':max(r['std'] for r in rows)}
(F/'coldreveal-analysis.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(summary,ensure_ascii=False,indent=2)[:3500])
