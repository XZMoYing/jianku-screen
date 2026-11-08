import subprocess
from pathlib import Path
T=Path('/private/tmp/jianku-alpha106-20261108')
FF='/Users/moyingxz/homebrew/bin/ffmpeg'
w,h=320,180; size=w*h*3
def frames(name):
    dec=subprocess.Popen([FF,'-v','error','-i',str(T/name),'-vf',f'scale={w}:{h}','-fps_mode','passthrough','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],stdout=subprocess.PIPE)
    out=[]
    while True:
        data=dec.stdout.read(size)
        if len(data)<size: break
        out.append(data)
    dec.wait(); return out
def region_diff(prev,cur,x0,y0,x1,y1):
    total=0; n=0
    for y in range(y0,y1):
        base=y*w
        for x in range(x0,x1):
            i=(base+x)*3
            total+=abs(prev[i]-cur[i])+abs(prev[i+1]-cur[i+1])+abs(prev[i+2]-cur[i+2]); n+=3
    return total/n if n else 0
a=frames('kb-export.mp4'); b=frames('kb-export-off.mp4')
# bottom-center overlay region
x0,y0,x1,y1=100,120,220,175
rows=[]
for i in range(1,len(a)):
    d=region_diff(a[i-1],a[i],x0,y0,x1,y1)
    rows.append((i/30.0,d))
tops=sorted(rows,key=lambda r:r[1],reverse=True)[:12]
print('top region diffs (on):',[(round(t,2),round(d,3)) for t,d in sorted(tops)])
# expected key times
print('expected key change times ~',1.815,2.515,4.0)
# off comparison: max region diff
rowoff=[region_diff(b[i-1],b[i],x0,y0,x1,y1) for i in range(1,len(b))]
print('off max',round(max(rowoff),3),'on max',round(max(d for _,d in rows),3))
