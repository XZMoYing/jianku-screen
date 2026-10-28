from pathlib import Path
import copy,hashlib,json,math,subprocess
w=Path('/private/tmp/jianku-camera-shadow')
src=Path('/private/tmp/jianku-frame-3d/fixtures/browser-motion.jks')
asset=w/'camera.mp4'
assert not asset.exists()
subprocess.run(['/Users/moyingxz/homebrew/bin/ffmpeg','-v','error','-f','lavfi','-i','testsrc2=size=256x256:rate=60:duration=9','-c:v','libx264','-crf','0','-pix_fmt','yuv420p',str(asset)],check=True)
manifest=[]
for name in ['overlay-motion','camera-only-motion','scene-transition','camera-shadow-off','flat-camera','hidden-camera','focus-blur-only']:
 p=w/'fixtures'/(name+'.jks');p.parent.mkdir(exist_ok=True);assert not p.exists()
 subprocess.run(['/bin/cp','-cR',str(src),str(p)],check=True)
 subprocess.run(['/bin/cp','-c',str(asset),str(p/'content/camera.mp4')],check=True)
 m=json.loads((p/'recording-meta.json').read_text());m['pretty_name']='摄像头投影验证 '+name
 for segment in m['segments']:segment['camera']={'path':'content/camera.mp4','fps':60,'start_time':0.0}
 (p/'recording-meta.json').write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
 c=json.loads((p/'project-config.json').read_text())
 c['background']['source']={'type':'color','value':[239,235,225],'alpha':255}
 c['camera'].update({'hide':False,'size':38.0,'rounding':30.0,'shadow':75.0,'manualPosition':{'x':0.5,'y':0.5},'advancedShadow':{'size':10.0,'opacity':70.0,'blur':40.0}})
 segment=c['timeline']['camera3dSegments'][0]
 segment['properties']={'tiltX':0.0,'tiltY':0.0,'roll':0.0,'rotateX':12.0,'rotateY':-16.0,'fov':40.0,'zoom':2.7,'panX':0.0,'panY':0.0}
 segment['tracks']={'panX':[{'time':0.0,'value':-0.1,'outEasing':None,'inEasing':None,'outSpring':{'range':[0.0,1.0]}},{'time':7.0,'value':0.1,'outEasing':None,'inEasing':None}]}
 if name=='camera-only-motion':c['timeline']['sceneSegments']=[{'start':0.0,'end':9.0,'mode':'cameraOnly','transitionIn':0.0,'transitionOut':0.0}]
 if name=='scene-transition':c['timeline']['sceneSegments']=[{'start':3.0,'end':6.0,'mode':'cameraOnly','transitionIn':0.6,'transitionOut':0.6}]
 if name=='camera-shadow-off':c['camera']['shadow']=0.0;c['background']['shadow']=0.0
 if name=='flat-camera':c['timeline']['camera3dSegments']=[]
 if name=='hidden-camera':c['camera']['hide']=True
 if name=='focus-blur-only':
  c['background']['frame']=None
  segment['properties']={'tiltX':0.0,'tiltY':0.0,'roll':0.0,'rotateX':0.0,'rotateY':0.0,'fov':45.0,'zoom':0.5625/math.tan(math.radians(22.5)),'panX':0.0,'panY':0.0}
  segment['tracks']={}
  segment['blur']['mode']='radial';segment['blur']['strength']=5.0
 (p/'project-config.json').write_text(json.dumps(c,ensure_ascii=False,indent=2)+'\n')
 (p/'.jianku-camera-shadow-fixture.json').write_text(json.dumps({'synthetic':True,'version':1})+'\n')
 lock=p/'.recovery.lock'
 if lock.exists():lock.unlink()
 manifest.append({'name':name,'path':str(p),'sha256':hashlib.sha256((p/'project-config.json').read_bytes()).hexdigest()})
(w/'fixtures.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('seven owned camera fixtures prepared')
