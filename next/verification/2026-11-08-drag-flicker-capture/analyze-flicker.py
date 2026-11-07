import json, subprocess, sys
from pathlib import Path
F=Path('/private/tmp/jianku-flicker-20261108')
FFMPEG='/Users/moyingxz/homebrew/bin/ffmpeg'
FFPROBE='/Users/moyingxz/homebrew/bin/ffprobe'
W,H=96,54

def frames(movie):
    meta=json.loads(subprocess.check_output([FFPROBE,'-v','error','-select_streams','v:0','-show_entries','frame=best_effort_timestamp_time','-of','json',str(movie)],text=True))['frames']
    dec=subprocess.Popen([FFMPEG,'-v','error','-i',str(movie),'-vf',f'scale={W}:{H}','-fps_mode','passthrough','-enc_time_base','1/1000000','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],stdout=subprocess.PIPE)
    size=W*H*3
    rows=[]; prev=None
    for i,frame in enumerate(meta):
        data=dec.stdout.read(size)
        assert len(data)==size, (i,len(data))
        luma=sum(int(v) for v in data)/size
        white=0; lightgray=0; dark=0; saturated=0
        for j in range(0,size,3):
            r,g,b=data[j],data[j+1],data[j+2]
            mn=min(r,g,b); mx=max(r,g,b)
            if mn>200: white+=1
            if mx-mn<10 and 140<=mn and mx<=245: lightgray+=1
            if mx<40: dark+=1
            if mx-mn>100: saturated+=1
        n=W*H
        diff=sum(abs(a-b) for a,b in zip(data,prev))/size if prev else 0
        rows.append({'index':i,'time':float(frame['best_effort_timestamp_time']),'luma':luma,'white':white/n,'lightgray':lightgray/n,'dark':dark/n,'saturated':saturated/n,'diff':diff})
        prev=data
    assert dec.stdout.read(1)==b'' and dec.wait()==0
    return rows

def summarize(rows, label, baseline=None):
    out={'label':label,'frames':len(rows),'duration':rows[-1]['time'] if rows else 0,
         'luma':{'min':min(r['luma'] for r in rows),'max':max(r['luma'] for r in rows)},
         'whiteMax':max(r['white'] for r in rows),'lightgrayMax':max(r['lightgray'] for r in rows),
         'darkMax':max(r['dark'] for r in rows),'saturatedMax':max(r['saturated'] for r in rows)}
    if baseline:
        bw=max(r['white'] for r in baseline); bg=max(r['lightgray'] for r in baseline)
        out['baselineWhiteMax']=bw; out['baselineLightgrayMax']=bg
        cand=[r for r in rows if (r['white']>max(bw+0.05,0.5)) or (r['lightgray']>max(bg+0.15,0.45)) or (r['luma']>max(rb['luma'] for rb in baseline)+40)]
        out['candidateFrames']=[{'index':r['index'],'time':round(r['time'],3),'luma':round(r['luma'],1),'white':round(r['white'],3),'lightgray':round(r['lightgray'],3),'diff':round(r['diff'],2)} for r in cand]
        runs=[]
        for r in cand:
            if runs and runs[-1]['endIndex']==r['index']-1:
                runs[-1]['endIndex']=r['index']; runs[-1]['frames']+=1
            else:
                runs.append({'startIndex':r['index'],'endIndex':r['index'],'startTime':round(r['time'],3),'frames':1})
        out['candidateRuns']=runs
        out['topDiff']=[{'index':r['index'],'time':round(r['time'],3),'diff':round(r['diff'],2),'white':round(r['white'],3),'lightgray':round(r['lightgray'],3)} for r in sorted(rows,key=lambda x:x['diff'],reverse=True)[:12]]
    return out

baseline=frames(F/'baseline.mov')
drag=frames(F/'drag.mov')
report={'baseline':summarize(baseline,'baseline'),'drag':summarize(drag,'drag',baseline)}
(F/'frame-analysis.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'baseline':{k:report['baseline'][k] for k in ('frames','duration','luma','whiteMax','lightgrayMax','darkMax','saturatedMax')},'drag':{k:report['drag'][k] for k in ('frames','duration','luma','whiteMax','lightgrayMax','darkMax','saturatedMax','candidateRuns','topDiff')}},ensure_ascii=False,indent=2))
# save candidate frame indices
(F/'candidate-indices.json').write_text(json.dumps({'drag':[r['index'] for r in report['drag'].get('candidateFrames',[])]},ensure_ascii=False)+'\n')
