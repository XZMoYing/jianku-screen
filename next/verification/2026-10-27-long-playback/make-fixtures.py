from pathlib import Path
import json,subprocess,struct,wave,os,argparse,shutil
parser=argparse.ArgumentParser()
parser.add_argument("--directory",type=Path,required=True)
parser.add_argument("--ffmpeg",default=shutil.which("ffmpeg"))
args=parser.parse_args()
if not args.ffmpeg:raise SystemExit("ffmpeg is required")
base=args.directory
base.mkdir(parents=True)
ff=args.ffmpeg
def run(args):subprocess.run([ff,'-v','error','-nostdin',*args],check=True)
source=base/'cycle.mp4';long=base/'display.mp4'
if not source.exists():run(['-f','lavfi','-i',"nullsrc=size=1280x720:rate=30:duration=4,geq=lum='40+40*mod(floor(T),4)':cb=128:cr=128",'-c:v','libx264','-preset','ultrafast','-crf','0','-g','30','-bf','0','-pix_fmt','yuv420p',str(source)])
if not long.exists():run(['-stream_loop','899','-i',str(source),'-c','copy','-t','3600',str(long)])
camera=base/'camera-cycle.mp4';camera_long=base/'camera.mp4'
if not camera.exists():run(['-f','lavfi','-i','testsrc2=size=160x160:rate=30:duration=4','-c:v','libx264','-preset','fast','-crf','18','-g','30','-bf','0',str(camera)])
if not camera_long.exists():run(['-stream_loop','899','-i',str(camera),'-c','copy','-t','3600',str(camera_long)])
wallpaper=base/'wallpaper.mp4'
if not wallpaper.exists():run(['-f','lavfi','-i','testsrc2=size=640x360:rate=30:duration=6','-vf','gblur=sigma=30','-c:v','libx264','-preset','fast','-crf','18','-g','30','-bf','0',str(wallpaper)])
for name,speed in [('normal',1),('fast',2),('slow',.5),('base',0)]:
 path=base/f'{name}.wav'
 if path.exists():continue
 with wave.open(str(path),'wb') as out:
  out.setnchannels(1);out.setsampwidth(2);out.setframerate(48000)
  for block in range(200):
   t=block/10
   amplitude=1000 if speed==0 else 4000*(int(t*speed)%4+1)
   out.writeframes(struct.pack('<h',amplitude)*4800)
for seconds in [600,1800,3600]:
 project=base/f'{seconds//60}分钟多轨回归.jks';content=project/'content';content.mkdir(parents=True,exist_ok=True)
 for name in ['display.mp4','camera.mp4','wallpaper.mp4','normal.wav','fast.wav','slow.wav','base.wav']:
  target=content/name
  if not target.exists():os.link(base/name,target)
 (project/'.jianku-long-project-fixture.json').write_text(json.dumps({'kind':'long-project-check','version':1})+'\n')
 metadata={'platform':'MacOS','pretty_name':f'{seconds//60}分钟多轨回归','segments':[{'display':{'path':'content/display.mp4','fps':30,'start_time':0.0},'camera':{'path':'content/camera.mp4','fps':30,'start_time':0.0},'audio':None,'cursor':None}],'cursors':{},'status':{'status':'Complete'}}
 timeline=[];audio=[];zooms=[]
 for index in range(seconds//20):
  speed=[1,2,.5][index%3];name=['normal','fast','slow'][index%3];start=index*20;source_start=((index*37)%3540)//4*4
  timeline.append({'recordingSegment':0,'start':source_start,'end':source_start+20*speed,'timescale':speed})
  audio.extend([{'start':start,'end':start+20,'path':f'content/{name}.wav','track':0},{'start':start,'end':start+20,'path':'content/base.wav','track':1}])
  zooms.append({'start':start+1,'end':start+4,'amount':1.5,'mode':'auto'})
 config={'background':{'source':{'type':'image','path':'content/wallpaper.mp4'},'padding':14,'inset':100,'rounding':7.5,'shadow':60,'frame':{'style':'browser','theme':'light','title':'长工程播放回归'}},'camera':{'hide':False,'size':20,'zoomSize':20,'scaleDuringZoom':1,'position':{'x':'right','y':'bottom'}},'cursor':{'hide':True},'screenMotionBlur':1,'timeline':{'segments':timeline,'zoomSegments':zooms,'audioSegments':audio}}
 for name,value in [('recording-meta.json',metadata),('project-config.json',config)]:
  (project/name).write_text(json.dumps(value,ensure_ascii=False,indent='\t')+'\n')
 print(project,flush=True)
