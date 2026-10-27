from pathlib import Path
import gzip,json,plistlib,subprocess,time
work=Path('/private/tmp/jianku-preview-package')
helper=work/'ax-control'
app=Path('/Applications/Jianku Screen Next.app')

def state(name=None):
 with (app/'Contents/Info.plist').open('rb') as f:info=plistlib.load(f)
 assert info['CFBundleShortVersionString']=='0.2.0-alpha.41'
 d=json.loads(subprocess.check_output([str(helper)]));assert d['trusted']
 if 'pid' in d:assert d['path']==str(app)
 if name:
  with gzip.open(work/(name+'.json.gz'),'wb') as f:f.write(json.dumps(d,ensure_ascii=False,indent=2).encode())
 return d

def act(n,action='AXPress'):
 d=json.loads(subprocess.check_output([str(helper),'action',str(n['index']),n['AXRole'],action]));assert d['actionStatus']==0,d

def press(**fields):
 d=state();ns=[n for n in d.get('nodes',[]) if all(n.get(k)==v for k,v in fields.items()) and 'AXPress' in n.get('actions',[])]
 assert len(ns)==1,ns
 act(ns[0])

def show(name=None):
 d=state(name);print({k:v for k,v in d.items() if k!='nodes'})
 for n in d.get('nodes',[]):
  if n.get('AXRole') not in ('AXGroup','AXWebArea','AXScrollArea','AXImage'):
   print({k:v for k,v in n.items() if k not in ('depth','valueSettable')})

def wait(read,seconds=25):
 end=time.monotonic()+seconds
 while time.monotonic()<end:
  d=read()
  if d:return d
  time.sleep(.25)
 raise TimeoutError('UI condition not observed')

def screenshot(name):
 windows=json.loads(subprocess.check_output([str(work/'windows')]))
 pid=state().get('pid');ws=[w for w in windows['windows'] if w['pid']==pid and '编辑' in w['name']]
 assert len(ws)==1,ws
 subprocess.run(['screencapture','-x','-l',str(ws[0]['id']),str(work/name)],check=True)
 (work/(name+'.window.json')).write_text(json.dumps(ws[0],ensure_ascii=False,indent=2)+'\n')
 print(ws[0])
 return ws[0]

def click(**fields):
 d=state();ns=[n for n in d['nodes'] if all(n.get(k)==v for k,v in fields.items())]
 assert len(ns)==1,ns
 n=ns[0];windows=json.loads(subprocess.check_output([str(work/'windows')]))['windows'];ws=[w for w in windows if w['pid']==d['pid'] and '编辑' in w['name']];assert len(ws)==1
 w=ws[0];x=n['position']['x']+n['size']['width']/2-w['bounds']['X'];y=n['position']['y']+n['size']['height']/2-w['bounds']['Y']
 subprocess.run([str(helper),'click-window',str(w['id']),str(x),str(y)],check=True,stdout=subprocess.DEVNULL)
