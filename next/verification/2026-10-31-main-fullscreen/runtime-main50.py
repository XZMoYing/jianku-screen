import json, subprocess, time
from pathlib import Path
area=Path('/private/tmp/jianku-picker-menus-20261031')
helper=str(area/'native-main')
owned='/private/tmp/jianku-alpha48/owned-ui'
app='/Applications/Jianku Screen Next.app'
results=[]
def call(mode):
 p=subprocess.run([helper,mode],capture_output=True,text=True)
 if p.returncode!=0:return None
 try:return json.loads(p.stdout)
 except json.JSONDecodeError:return None
def wait(name,predicate):
 deadline=time.monotonic()+12
 while time.monotonic()<deadline:
  value=call('read')
  if value is not None and predicate(value):
   (area/(name+'.json')).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
   return value
  time.sleep(.2)
 raise RuntimeError('Did not observe '+name)
def layer(d):return d['visibleMainWindows'][0]['layer'] if len(d['visibleMainWindows'])==1 else None
def record(name,**data):
 results.append(dict(name=name,passed=True,**data))
 (area/'runtime-main50-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
 print(name,flush=True)
def fullscreen_cycle(prefix,expected_layer):
 call('zoom')
 value=wait(prefix+'-fullscreen',lambda d:d['fullscreen'] and len(d['visibleMainWindows'])==1)
 record(prefix+' native green enters system fullscreen',nativeFullscreen=value['fullscreen'])
 time.sleep(1)
 call('fullscreen-off')
 wait(prefix+'-windowed',lambda d:not d['fullscreen'] and layer(d)==expected_layer)
 time.sleep(1)
 call('restore-geometry')
 value=wait(prefix+'-bounds',lambda d:not d['fullscreen'] and layer(d)==expected_layer and d['visibleMainWindows'][0]['bounds']['Width']==1120)
 record(prefix+' fullscreen exit restores native window level',layer=expected_layer)
def wait_gone():
 deadline=time.monotonic()+10
 while time.monotonic()<deadline:
  p=subprocess.run(['pgrep','-f',app+'/Contents/MacOS/Jianku Screen Next( |$)'],capture_output=True)
  if p.returncode==1:return
  time.sleep(.15)
 raise RuntimeError('Owned app did not normally terminate')
call('raise')
wait('alpha50-default',lambda d:not d['fullscreen'] and layer(d)==0)
record('Fresh alpha50 Main is ordinary unpinned native window')
fullscreen_cycle('alpha50-unpinned',0)
call('pin-click')
wait('alpha50-pin',lambda d:not d['fullscreen'] and layer(d)==5)
record('Alpha50 pin enters native floating layer',layer=5)
fullscreen_cycle('alpha50-pinned',5)
subprocess.run(['/private/tmp/jianku-frame-3d/quit-owned'],check=True,capture_output=True)
wait_gone()
subprocess.run(['/usr/bin/open','-a',app],check=True)
wait('alpha50-pinned-restarted',lambda d:not d['fullscreen'] and layer(d)==5)
record('Pinned preference survives normal app restart',layer=5)
call('raise')
fullscreen_cycle('alpha50-restarted-pinned',5)
call('pin-click')
wait('alpha50-unpinned-restored',lambda d:not d['fullscreen'] and layer(d)==0)
record('Unpin restores ordinary native level',layer=0)
call('minimize')
wait('alpha50-minimized',lambda d:d['minimized'])
call('unminimize')
wait('alpha50-unminimized',lambda d:not d['minimized'] and layer(d)==0)
record('Native minimize and restore')
call('close')
deadline=time.monotonic()+10
while time.monotonic()<deadline:
 windows=json.loads(subprocess.check_output([owned,'windows'],text=True))
 if not any(w.get('kCGWindowName') in ['简库镜传 Next','Jianku Screen Next'] for w in windows):break
 time.sleep(.15)
else:raise RuntimeError('Main did not close')
record('Native close removes visible Main')
subprocess.run(['/usr/bin/open','-a',app],check=True)
wait('alpha50-reopened',lambda d:not d['fullscreen'] and not d['minimized'] and layer(d)==0)
call('restore-geometry')
wait('alpha50-final-main',lambda d:not d['fullscreen'] and layer(d)==0 and d['visibleMainWindows'][0]['bounds']=={'X':250,'Y':98,'Width':1120,'Height':800})
record('Closed Main reopens unpinned with original geometry restored')
