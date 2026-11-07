import json, subprocess
from pathlib import Path
F=Path('/private/tmp/jianku-flicker-20261108')
FFMPEG='/Users/moyingxz/homebrew/bin/ffmpeg'
FFPROBE='/Users/moyingxz/homebrew/bin/ffprobe'
W,H=96,54
cap=json.loads((F/'reverse.log').read_text().splitlines()[-1])
start=cap['firstSampleAtUnix']
actions=json.loads((F/'reverse-actions.json').read_text())
meta=json.loads(subprocess.check_output([FFPROBE,'-v','error','-select_streams','v:0','-show_entries','frame=best_effort_timestamp_time','-of','json',str(F/'reverse.mov')],text=True))['frames']
dec=subprocess.Popen([FFMPEG,'-v','error','-i',str(F/'reverse.mov'),'-vf',f'scale={W}:{H}','-fps_mode','passthrough','-enc_time_base','1/1000000','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],stdout=subprocess.PIPE)
size=W*H*3
rows=[]; prev=None
for frame in meta:
    data=dec.stdout.read(size)
    assert len(data)==size
    t=float(frame['best_effort_timestamp_time'])
    diff=sum(abs(a-b) for a,b in zip(data,prev))/size if prev else 0
    luma=sum(data)/size
    light=0
    for j in range(0,size,3):
        r,g,b=data[j],data[j+1],data[j+2]
        mn=min(r,g,b); mx=max(r,g,b)
        if mx-mn<10 and 140<=mn<=245: light+=1
    rows.append({'t':t,'diff':diff,'luma':luma,'light':light/(W*H)})
    prev=data
assert dec.stdout.read(1)==b'' and dec.wait()==0
active_lo=actions[0]['eventStartUnix']-start-0.2
active_hi=actions[-1]['eventStartUnix']-start+1.2
quiet=[r for r in rows if r['t']<active_lo or r['t']>active_hi]
ql=sorted(r['luma'] for r in quiet)[len(quiet)//2]
qm=sorted(r['light'] for r in quiet)[len(quiet)//2]
print('quiet frames',len(quiet),'median luma',round(ql,1),'median light',round(qm,3))
active=[r for r in rows if active_lo<=r['t']<=active_hi]
susp=[r for r in active if abs(r['luma']-ql)>6 or r['light']>qm+0.04]
print('active frames',len(active),'suspicious',len(susp))
for r in susp[:10]: print(' susp',round(r['t'],2),'diff',round(r['diff'],1),'luma',round(r['luma'],1),'light',round(r['light'],3))
top=sorted(active,key=lambda r:r['diff'],reverse=True)[:8]
print('top diffs',[(round(r['t'],2),round(r['diff'],1),round(r['luma'],1)) for r in top])
gaps=[rows[i+1]['t']-rows[i]['t'] for i in range(len(rows)-1) if active_lo<=rows[i]['t']<=active_hi]
print('active gaps max ms',round(max(gaps)*1000,1),'over80',sum(1 for g in gaps if g>0.08),'over100',sum(1 for g in gaps if g>0.1))
summary={'frames':len(rows),'duration':round(rows[-1]['t'],2),'quietMedianLuma':round(ql,1),'quietMedianLight':round(qm,3),
 'activeFrames':len(active),'suspiciousWholeWindowFrames':len(susp),
 'suspicious':[{'t':round(r['t'],2),'diff':round(r['diff'],1),'luma':round(r['luma'],1),'light':round(r['light'],3)} for r in susp],
 'topDiffs':[{'t':round(r['t'],2),'diff':round(r['diff'],1)} for r in top],
 'activeGapMs':{'max':round(max(gaps)*1000,1),'over80':sum(1 for g in gaps if g>0.08),'over100':sum(1 for g in gaps if g>0.1)}}
(F/'reverse-analysis.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(summary,ensure_ascii=False,indent=2)[:2500])
