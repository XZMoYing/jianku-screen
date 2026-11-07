import json, subprocess
from pathlib import Path
F=Path('/private/tmp/jianku-flicker-20261108')
FFMPEG='/Users/moyingxz/homebrew/bin/ffmpeg'
FFPROBE='/Users/moyingxz/homebrew/bin/ffprobe'
W,H=96,54
cap=json.loads((F/'latency2.log').read_text().splitlines()[-1])
start=cap['firstSampleAtUnix']
actions=json.loads((F/'latency2-actions.json').read_text())
meta=json.loads(subprocess.check_output([FFPROBE,'-v','error','-select_streams','v:0','-show_entries','frame=best_effort_timestamp_time','-of','json',str(F/'latency2.mov')],text=True))['frames']
dec=subprocess.Popen([FFMPEG,'-v','error','-i',str(F/'latency2.mov'),'-vf',f'scale={W}:{H}','-fps_mode','passthrough','-enc_time_base','1/1000000','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],stdout=subprocess.PIPE)
size=W*H*3
frames=[]; prev=None
for frame in meta:
    data=dec.stdout.read(size)
    assert len(data)==size
    t=float(frame['best_effort_timestamp_time'])
    diff=sum(abs(a-b) for a,b in zip(data,prev))/size if prev else 0
    frames.append({'t':t,'diff':diff})
    prev=data
assert dec.stdout.read(1)==b'' and dec.wait()==0
def latency(action, threshold=0.08, horizon=0.8):
    t0=action['eventStartUnix']-start
    for f in frames:
        if f['t'] < t0: continue
        if f['t'] > t0+horizon: break
        if f['diff'] > threshold:
            return {'diff':round(f['diff'],2),'latencyMs':round((f['t']-t0)*1000,1)}
    return None
report={'frames':len(frames),'duration':round(frames[-1]['t'],2),'maxGapMs':round(cap['maximumSampleGapMs'],1),'actions':[]}
for a in actions:
    r=latency(a)
    report['actions'].append({'action':a['action'],**(r if r else {'latencyMs':None,'note':'no visible change within 0.8s (threshold 0.08)'})})
t_start=min(a['eventStartUnix'] for a in actions)-start
t_end=max(a['eventStartUnix'] for a in actions)-start
gaps=[frames[i+1]['t']-frames[i]['t'] for i in range(len(frames)-1) if t_start<=frames[i]['t']<=t_end]
report['interactionWindow']={'start':round(t_start,2),'end':round(t_end,2),'maxGapMs':round(max(gaps)*1000,1),'gapsOver80ms':sum(1 for g in gaps if g>0.08),'gapsOver100ms':sum(1 for g in gaps if g>0.1)}
(F/'latency2-analysis.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
