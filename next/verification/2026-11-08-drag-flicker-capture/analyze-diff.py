import json, subprocess
from pathlib import Path
F=Path('/private/tmp/jianku-flicker-20261108')
FFMPEG='/Users/moyingxz/homebrew/bin/ffmpeg'
FFPROBE='/Users/moyingxz/homebrew/bin/ffprobe'
W,H=96,54
def load(movie):
    meta=json.loads(subprocess.check_output([FFPROBE,'-v','error','-select_streams','v:0','-show_entries','frame=best_effort_timestamp_time','-of','json',str(movie)],text=True))['frames']
    dec=subprocess.Popen([FFMPEG,'-v','error','-i',str(movie),'-vf',f'scale={W}:{H}','-fps_mode','passthrough','-enc_time_base','1/1000000','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],stdout=subprocess.PIPE)
    size=W*H*3
    out=[]
    for frame in meta:
        data=dec.stdout.read(size)
        assert len(data)==size
        out.append((float(frame['best_effort_timestamp_time']),data))
    assert dec.stdout.read(1)==b'' and dec.wait()==0
    return out
baseline=load(F/'baseline.mov')
drag=load(F/'drag.mov')
ref=baseline[len(baseline)//2][1]
def stats(rows):
    res=[]
    prev=None
    for t,data in rows:
        n=len(data)
        changed=sum(1 for a,b in zip(data,ref) if abs(a-b)>25)/n
        luma=sum(data)/n
        # panel-ish: fraction dark or lightgray
        lightgray=0; dark=0
        for j in range(0,len(data),3):
            r,g,b=data[j],data[j+1],data[j+2]
            mn=min(r,g,b); mx=max(r,g,b)
            if mx-mn<10 and 140<=mn and mx<=245: lightgray+=1
            if mx<40: dark+=1
        diff=sum(abs(a-b) for a,b in zip(data,prev))/n if prev else 0
        res.append({'time':t,'changed':changed,'luma':luma,'lightgray':lightgray/(W*H),'dark':dark/(W*H),'diff':diff})
        prev=data
    return res
b=stats(baseline); d=stats(drag)
summary={
 'baseline': {'changedMax':max(x['changed'] for x in b),'luma':[min(x['luma'] for x in b),max(x['luma'] for x in b)],'lightgrayMax':max(x['lightgray'] for x in b)},
 'drag': {'changedMax':max(x['changed'] for x in d),'changedTop':sorted(d,key=lambda x:x['changed'],reverse=True)[:10],'diffTop':sorted(d,key=lambda x:x['diff'],reverse=True)[:10],'lumaMin':min(x['luma'] for x in d),'lumaMax':max(x['luma'] for x in d),'lightgrayMax':max(x['lightgray'] for x in d),'darkMax':max(x['dark'] for x in d)},
 'framesAroundDragStart': [ {k:round(v,4) if isinstance(v,float) else v for k,v in x.items()} for x in d if 0.85<=x['time']<=1.15 ],
}
(F/'frame-diff-analysis.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:summary[k] for k in ('baseline','drag','framesAroundDragStart')},ensure_ascii=False,indent=2)[:5000])
