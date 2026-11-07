import json, subprocess
from pathlib import Path
T=Path('/private/tmp/jianku-alpha104-20261108')
FFMPEG='/Users/moyingxz/homebrew/bin/ffmpeg'
FFPROBE='/Users/moyingxz/homebrew/bin/ffprobe'
W,H=96,54
cap=json.loads((T/'lang.log').read_text().splitlines()[-1])
start=cap['firstSampleAtUnix']
actions=json.loads((T/'lang-actions.json').read_text())
meta=json.loads(subprocess.check_output([FFPROBE,'-v','error','-select_streams','v:0','-show_entries','frame=best_effort_timestamp_time','-of','json',str(T/'lang.mov')],text=True))['frames']
dec=subprocess.Popen([FFMPEG,'-v','error','-i',str(T/'lang.mov'),'-vf',f'scale={W}:{H}','-fps_mode','passthrough','-enc_time_base','1/1000000','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],stdout=subprocess.PIPE)
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
        if mx-mn<12 and 180<=mn<=250: light+=1
    rows.append({'t':t,'diff':diff,'luma':luma,'light':light/(W*H)})
    prev=data
assert dec.stdout.read(1)==b'' and dec.wait()==0
quiet=[r for r in rows if r['t']<0.5]
ql=sorted(r['luma'] for r in quiet)[len(quiet)//2] if quiet else 0
susp=[]
for r in rows:
    if r['t']<0.4: continue
    if r['diff']>6 or r['light']>0.6 or r['luma']>235 or abs(r['luma']-ql)>25:
        susp.append(r)
# runs
runs=[]; cur=[]
for r in rows:
    if r in susp: cur.append(r)
    else:
        if cur: runs.append(cur); cur=[]
if cur: runs.append(cur)
gaps=[rows[i+1]['t']-rows[i]['t'] for i in range(len(rows)-1)]
out={
 'frames':len(rows),'duration':round(rows[-1]['t'],2),'maxGapMs':round(max(gaps)*1000,1),
 'quietMedianLuma':round(ql,1),'suspiciousFrames':len(susp),
 'runs':[{'start':round(r[0]['t'],2),'end':round(r[-1]['t'],2),'count':len(r),'maxDiff':round(max(x['diff'] for x in r),1),'maxLight':round(max(x['light'] for x in r),2),'maxLuma':round(max(x['luma'] for x in r),1)} for r in runs],
 'actions':[{'action':a['action'],'rel':round(a['at']-start,2)} for a in actions],
 'top':[{'t':round(r['t'],2),'diff':round(r['diff'],1),'luma':round(r['luma'],1),'light':round(r['light'],2)} for r in sorted(rows,key=lambda x:x['diff'],reverse=True)[:10]],
}
(T/'lang-analysis.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(out,ensure_ascii=False,indent=2)[:3500])
