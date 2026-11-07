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

def analyze(movie, label):
    rows=load(movie)
    stats=[]
    prev=None
    for t,data in rows:
        n=len(data); diff=sum(abs(a-b) for a,b in zip(data,prev))/n if prev else 0
        luma=sum(data)/n
        lightgray=0
        for j in range(0,len(data),3):
            r,g,b=data[j],data[j+1],data[j+2]
            mn=min(r,g,b); mx=max(r,g,b)
            if mx-mn<10 and 140<=mn and mx<=245: lightgray+=1
        stats.append({'t':t,'diff':diff,'luma':luma,'lightgray':lightgray/(W*H)})
        prev=data
    times=[t for t,_ in rows]
    gaps=[b-a for a,b in zip(times,times[1:])]
    freeze=[]
    run=0; start=None
    for row in stats[1:]:
        if row['diff']<0.35:
            if run==0: start=row['t']
            run+=1
        else:
            if run>=3: freeze.append({'start':round(start or 0,3),'frames':run,'duration':round(stats[list(stats).index(row)]['t']-(start or 0),3)})
            run=0; start=None
    if run>=3:
        freeze.append({'start':round(start or 0,3),'frames':run,'duration':round(stats[-1]['t']-(start or 0),3)})
    return {
      'label':label,'frames':len(rows),'duration':round(times[-1],3) if times else 0,
      'gapMs':{'max':round(max(gaps)*1000,2) if gaps else 0,'p95':round(sorted(gaps)[int(len(gaps)*0.95)]*1000,2) if gaps else 0,'over100ms':sum(1 for g in gaps if g>0.1)},
      'luma':{ 'min':round(min(r['luma'] for r in stats),1),'max':round(max(r['luma'] for r in stats),1)},
      'lightgrayMax':round(max(r['lightgray'] for r in stats),3),
      'freezeRuns':freeze[:10],
      'topDiff':[{'t':round(r['t'],3),'diff':round(r['diff'],2)} for r in sorted(stats,key=lambda x:x['diff'],reverse=True)[:10]],
    }
base=analyze(F/'tab-baseline.mov','baseline')
switch=analyze(F/'tab-switch.mov','rapid-switch')
report={'baseline':base,'rapidSwitch':switch}
(F/'tab-switch-analysis.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2)[:5000])
