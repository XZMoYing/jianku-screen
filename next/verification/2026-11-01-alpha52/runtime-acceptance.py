import json,subprocess,time,plistlib
from pathlib import Path
R=Path('/private/tmp/jianku-alpha52-20261101/clean-first-run');H='/private/tmp/jianku-fullscreen-native/ax-control-geometry';U='/private/tmp/jianku-alpha48/owned-ui';P=R/'拖动与缩放验收.jks/project-config.json';rows=[]
assert plistlib.loads(Path('/Applications/Jianku Screen Next.app/Contents/Info.plist').read_bytes())['CFBundleShortVersionString']=='0.2.0-alpha.52'
def read():
 end=time.monotonic()+10
 while True:
  r=subprocess.run([H],capture_output=True,text=True)
  if r.returncode==0:
   j=json.loads(r.stdout)
   if j['path']=='/Applications/Jianku Screen Next.app' and any('独立首轮复验' in n.get('AXValue','') for n in j['nodes']):return j
  if time.monotonic()>end:raise RuntimeError('Editor not ready')
  time.sleep(.2)
def cfg():return json.loads(P.read_text())
def val(c,name):return next(x for x in c['timeline']['audioSegments'] if x['name']==name)['start']
def note(name,passed,**extra):
 rows.append(dict(check=name,passed=passed,**extra));(R/'runtime-results.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n');print(rows[-1],flush=True);assert passed,rows[-1]
def wait_config(name,predicate):
 end=time.monotonic()+8
 while True:
  c=cfg()
  if predicate(c):note(name,True);return c
  if time.monotonic()>end:note(name,False)
  time.sleep(.1)
def action(predicate,kind='AXPress'):
 j=read();ns=[n for n in j['nodes'] if predicate(n)];assert len(ns)==1 and kind in ns[0].get('actions',[]) and ns[0].get('AXEnabled')!='0',ns;n=ns[0];r=json.loads(subprocess.check_output([H,'action',str(n['index']),n['AXRole'],kind],text=True));assert r['actionStatus']==0
j=read();c=cfg();note('initial-unmeasured-text',all(abs(t['size']['x']-.1)<1e-9 for t in c['timeline']['textSegments']))
w=next(w for w in json.loads(subprocess.check_output([U,'windows'],text=True)) if '视频编辑' in w.get('kCGWindowName',''));b=w['kCGWindowBounds'];wid=w['kCGWindowNumber']
def center(value):
 ns=[n for n in read()['nodes'] if n.get('AXRole')=='AXStaticText' and n.get('AXValue')==value];assert len(ns)==1;n=ns[0];return n['position']['x']+n['size']['width']/2,n['position']['y']+n['size']['height']/2
ax,ay=center('音频 A');bx,by=center('音频 B');scale=(bx-ax)/8
subprocess.run([str(R.parent/'drag-owned'),str(wid),str(ax-b['X']),str(ay-b['Y']),str(ax-b['X']+scale*9),str(ay-b['Y']),'60','1.5'],check=True,stdout=subprocess.DEVNULL)
c=wait_config('audio-move',lambda c:val(c,'音频 A')>10 and val(c,'音频 B')==10);moved=val(c,'音频 A')
for name,x,expected in [('first-undo',895,2),('first-redo',927,moved)]:
 action(lambda n:n['AXRole']=='AXButton' and n.get('position')=={'x':x,'y':114});wait_config(name,lambda c:abs(val(c,'音频 A')-expected)<1e-6 and val(c,'音频 B')==10)
x,y=center('文字 A');r=json.loads(subprocess.check_output([H,'click-window',str(wid),str(x-b['X']),str(y-b['Y'])],text=True));time.sleep(.5)
def font(n):return n.get('AXRole')=='AXSlider' and n.get('AXValue')=='48' and n.get('position',{}).get('x',0)>900
ns=[n for n in read()['nodes'] if font(n)];assert len(ns)==1,ns
action(font,'AXScrollToVisible');action(font,'AXIncrement');c=wait_config('font-changed',lambda c:c['timeline']['textSegments'][0]['fontSize']!=48);size=c['timeline']['textSegments'][0]['fontSize']
for name,x,expected in [('font-undo',895,48),('font-redo',927,size)]:
 action(lambda n:n['AXRole']=='AXButton' and n.get('position')=={'x':x,'y':114});wait_config(name,lambda c:c['timeline']['textSegments'][0]['fontSize']==expected and abs(val(c,'音频 A')-moved)<1e-6)
before=cfg();(R/'before-reopen.json').write_text(json.dumps(before,ensure_ascii=False,indent=2)+'\n');action(lambda n:n.get('AXRole')=='AXButton' and n.get('depth')==1 and n.get('position')=={'x':222,'y':122});time.sleep(.3);subprocess.run(['open','-a','/Applications/Jianku Screen Next.app',str(P.parent)],check=True);read();time.sleep(.5);after=cfg();note('reopen-keeps-audio-font',after['timeline']['audioSegments']==before['timeline']['audioSegments'] and after['timeline']['textSegments'][0]['fontSize']==size)
