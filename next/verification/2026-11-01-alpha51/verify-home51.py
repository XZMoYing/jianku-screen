import json,subprocess,time,pathlib,datetime
ROOT=pathlib.Path('/private/tmp/jianku-alpha51-20261101')
import plistlib
assert plistlib.loads(pathlib.Path('/Applications/Jianku Screen Next.app/Contents/Info.plist').read_bytes())['CFBundleShortVersionString']=='0.2.0-alpha.51'
UI='/private/tmp/jianku-alpha48/owned-ui'
TITLE='简库镜传 Next'
rows=[]
def call(*args):
 r=subprocess.run([UI,*args],capture_output=True,text=True,timeout=12)
 if r.returncode: raise RuntimeError(f'{args[0]} failed: {r.stderr[:180]}')
 return r.stdout
def read(): return json.loads(call('read',TITLE))
def has(o,label,role=None): return any(label in [n.get('AXTitle'),n.get('AXDescription')] and (not role or n.get('AXRole')==role) for n in o['nodes'])
def val(o,label):
 ns=[n for n in o['nodes'] if label in [n.get('AXTitle'),n.get('AXDescription')] and n.get('AXRole')=='AXCheckBox']
 return ns[0].get('AXValue') if len(ns)==1 else None
def lists(o): return sum(n.get('AXRole') in ['AXList','AXMenu'] for n in o['nodes'])
def wait(name,predicate):
 until=time.monotonic()+10
 while True:
  o=read()
  if predicate(o):
   (ROOT/f'{len(rows):02d}-{name}-private.json').write_text(json.dumps(o,ensure_ascii=False))
   row={'check':name,'passed':True,'recording':val(o,'录屏'),'presentation':val(o,'演示'),'desktop':val(o,'电脑屏幕'),'mobile':val(o,'手机与平板'),'openLists':lists(o),'pin':val(o,'主窗口置顶'),'bounds':o['bounds'],'captureRatioFit':has(o,'捕获画面比例 适合屏幕')}
   rows.append(row);(ROOT/'functional-results.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n');print(json.dumps(row,ensure_ascii=False),flush=True);return o
  if time.monotonic()>until: raise AssertionError(name)
  time.sleep(.08)
def press(label):
 o=read();assert has(o,label),label
 call('press',TITLE,label)
def desktop(o): return val(o,'录屏')=='1' and val(o,'电脑屏幕')=='1' and has(o,'选择显示器')
def presentation(o): return val(o,'演示')=='1' and has(o,'输出比例 适合屏幕 · 默认') and not has(o,'电脑屏幕')

call('raise', TITLE)
original=read()
original_mode=val(original,'演示')=='1'
original_mobile=val(original,'手机与平板')=='1'
try:
 press('录屏');wait('recording-ready',lambda o:val(o,'录屏')=='1')
 press('手机与平板');wait('mobile-ready',lambda o:val(o,'手机与平板')=='1' and has(o,'录制设备','AXPopUpButton'))
 call('reveal',TITLE,'刷新列表');time.sleep(1)
 before=read()
 def anchor(o):
  nodes=[n for n in o['nodes'] if n.get('AXRole')=='AXButton' and n.get('AXTitle')=='刷新列表']
  assert len(nodes)==1
  return nodes[0]['position'][1]
 press('演示');wait('presentation-ready',lambda o:val(o,'演示')=='1' and not has(o,'电脑屏幕'))
 press('录屏');wait('mobile-returned',lambda o:val(o,'录屏')=='1' and val(o,'手机与平板')=='1' and has(o,'录制设备','AXPopUpButton'))
 time.sleep(1);after=read()
 result={'check':'alpha51-mobile-scroll-after-source-refresh','beforeAnchorY':anchor(before),'afterAnchorY':anchor(after),'delta':anchor(after)-anchor(before),'boundsUnchanged':before['bounds']==after['bounds'],'passed':abs(anchor(before)-anchor(after))<=1 and before['bounds']==after['bounds'],'scope':'installed app AX anchor; no refresh/capture/device buttons pressed'}
 (ROOT/'scroll-retention.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps(result,ensure_ascii=False),flush=True)
 assert result['passed'],result
finally:
 if val(read(),'演示')=='1':press('录屏');wait('recording-before-restore',lambda o:val(o,'录屏')=='1')
 source='手机与平板' if original_mobile else '电脑屏幕'
 call('reveal',TITLE,source);press(source);wait('original-source-restored',lambda o:val(o,source)=='1')
 if original_mode:press('演示');wait('original-presentation-restored',lambda o:val(o,'演示')=='1')
