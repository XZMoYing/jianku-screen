import json, subprocess
from pathlib import Path
F=Path('/private/tmp/jianku-flicker-20261108')
FFMPEG='/Users/moyingxz/homebrew/bin/ffmpeg'
FFPROBE='/Users/moyingxz/homebrew/bin/ffprobe'
W,H=96,54
movie=F/'coldwatch.mov'
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
    lightgray=0; dark=0
    for j in range(0,len(data),3):
        r,g,b=data[j],data[j+1],data[j+2]
        mn=min(r,g,b); mx=max(r,g,b)
        if mx-mn<10 and 140<=mn and mx<=245: lightgray+=1
        if mx<40: dark+=1
    rows.append({'t':round(t,3),'changedVsLoaded':round(changed,4),'diff':round(diff,3),'luma':round(luma,1),'lightgray':round(lightgray/(W*H),4),'dark':round(dark/(W*H),4)})
    prev=data
summary={
 'movie':str(movie),'frames':len(rows),'duration':rows[-1]['t'],
 'first12':rows[:12],
 'changedVsLoadedMax':max(r['changedVsLoaded'] for r in rows),
 'skeletonCandidates':[r for r in rows if r['changedVsLoaded']>0.3][:20],
 'diffTop':sorted(rows,key=lambda r:r['diff'],reverse=True)[:10],
 'lumaRange':[min(r['luma'] for r in rows),max(r['luma'] for r in rows)],
 'lightgrayRange':[min(r['lightgray'] for r in rows),max(r['lightgray'] for r in rows)],
}
(F/'coldwatch-analysis.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:summary[k] for k in ('frames','duration','changedVsLoadedMax','lumaRange','lightgrayRange')},ensure_ascii=False,indent=2))
print('first12:',json.dumps(summary['first12'],ensure_ascii=False))
print('candidates:',json.dumps(summary['skeletonCandidates'][:8],ensure_ascii=False))
print('diffTop:',json.dumps(summary['diffTop'][:6],ensure_ascii=False))
