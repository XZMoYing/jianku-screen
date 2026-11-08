import subprocess
from pathlib import Path
T=Path('/private/tmp/jianku-alpha106-20261108')
FF='/Users/moyingxz/homebrew/bin/ffmpeg'
w,h=160,90; size=w*h*3
def frames(name):
    dec=subprocess.Popen([FF,'-v','error','-i',str(T/name),'-vf',f'scale={w}:{h}','-fps_mode','passthrough','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],stdout=subprocess.PIPE)
    out=[]
    while True:
        data=dec.stdout.read(size)
        if len(data)<size: break
        out.append(data)
    dec.wait()
    return out
a=frames('kb-export.mp4'); b=frames('kb-export-off.mp4')
print('frames',len(a),len(b))
rows=[]
for i,(x,y) in enumerate(zip(a,b)):
    d=sum(abs(p-q) for p,q in zip(x,y))/size
    rows.append((i/30.0,d))
active=[(round(t,2),round(d,3)) for t,d in rows if d>0.05]
print('diff frames count',len(active))
print('first 20',active[:20])
print('segments:',active[:3], active[-3:])
# group contiguous
groups=[]; cur=[]
for t,d in rows:
    if d>0.05: cur.append((t,d))
    else:
        if cur: groups.append(cur); cur=[]
if cur: groups.append(cur)
print('groups',[(round(g[0][0],2),round(g[-1][0],2),round(max(d for _,d in g),2)) for g in groups][:10])
