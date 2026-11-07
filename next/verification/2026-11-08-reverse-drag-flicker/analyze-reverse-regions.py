import json, subprocess
from pathlib import Path
F=Path('/private/tmp/jianku-flicker-20261108')
FFMPEG='/Users/moyingxz/homebrew/bin/ffmpeg'
FFPROBE='/Users/moyingxz/homebrew/bin/ffprobe'
W,H=96,54
# regions in full-res window coords (1680x954): preview canvas approx x 129..1168,y 132..592; timeline y 675..949
regions={
 'preview':(129,132,1168,592),
 'timeline':(129,675,1664,949),
 'inspector':(1180,87,1680,949),
}
meta=json.loads(subprocess.check_output([FFPROBE,'-v','error','-select_streams','v:0','-show_entries','frame=best_effort_timestamp_time','-of','json',str(F/'reverse.mov')],text=True))['frames']
# decode full frames at 1680x954? too heavy; decode scaled 480x273 and map regions proportionally
CW,CH=480,273
dec=subprocess.Popen([FFMPEG,'-v','error','-i',str(F/'reverse.mov'),'-vf',f'scale={CW}:{CH}','-fps_mode','passthrough','-enc_time_base','1/1000000','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],stdout=subprocess.PIPE)
size=CW*CH*3
scale_x=CW/1680; scale_y=CH/954
rects={name:(int(x0*scale_x),int(y0*scale_y),int(x1*scale_x),int(y1*scale_y)) for name,(x0,y0,x1,y1) in regions.items()}
frames=[]; prev=None
for frame in meta:
    data=dec.stdout.read(size)
    assert len(data)==size
    t=float(frame['best_effort_timestamp_time'])
    stats={}
    for name,(x0,y0,x1,y1) in rects.items():
        diffs=[]; luma=0; n=0
        for y in range(y0,y1):
            row=y*CW
            for x in range(x0,x1):
                i=(row+x)*3
                luma+=data[i]+data[i+1]+data[i+2]
                n+=3
                if prev is not None:
                    diffs.append(abs(data[i]-prev[i])+abs(data[i+1]-prev[i+1])+abs(data[i+2]-prev[i+2]))
        stats[name]={'diff': (sum(diffs)/len(diffs)/3) if diffs else 0.0,'luma':luma/n}
    frames.append({'t':t,**stats})
    prev=data
assert dec.stdout.read(1)==b'' and dec.wait()==0
summary={}
for name in regions:
    vals=[f[name]['diff'] for f in frames]
    lums=[f[name]['luma'] for f in frames]
    summary[name]={
      'diffMean':round(sum(vals)/len(vals),3),'diffMax':round(max(vals),3),
      'diffTop':[{'t':round(f['t'],2),'diff':round(f[name]['diff'],2)} for f in sorted(frames,key=lambda f:f[name]['diff'],reverse=True)[:8]],
      'lumaMin':round(min(lums),1),'lumaMax':round(max(lums),1),
    }
(F/'reverse-region-analysis.json').write_text(json.dumps({'regions':regions,'scaled':list(rects.values()),'summary':summary},ensure_ascii=False,indent=2)+'\n')
print(json.dumps(summary,ensure_ascii=False,indent=2)[:3000])
