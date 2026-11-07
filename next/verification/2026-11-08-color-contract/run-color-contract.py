import json, subprocess
from pathlib import Path
W=Path('/private/tmp/jianku-color-20261108')
CLI=Path('/Users/moyingxz/Documents/Zzx/05_项目开发/Jianku Screen Next/next/cap/target/release/cap-cli')
def center(mp4):
    raw=subprocess.check_output(['ffmpeg','-v','error','-i',str(mp4),'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'])
    i=((360//2)*640+640//2)*3
    return [raw[i],raw[i+1],raw[i+2]]
def run_export(color):
    out=W/f'{color}-export.mp4'
    result=subprocess.run([str(CLI),'--json','export',str(W/f'{color}.jks'),'--output',str(out),'--format','mp4','--fps','30','--resolution','640x360','--quality','maximum'],capture_output=True,text=True)
    (W/f'{color}-export.log').write_text(result.stdout+result.stderr)
    return result.returncode
for color in ('red','gray','blue'):
    code=run_export(color)
    print(color,'exit',code,'source',center(W/f'{color}-src.mp4'),'export',center(W/f'{color}-export.mp4'))
