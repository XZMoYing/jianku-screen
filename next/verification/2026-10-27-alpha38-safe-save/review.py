from pathlib import Path
import hashlib,json,os,subprocess,time,traceback

work=Path('/private/tmp/jianku-alpha38-save')
app=Path('/Applications/Jianku Screen Next.app')
helper=work/'ax-control'
project=work/'保存与重试示例.jks'
config=project/'project-config.json'
report={'version':'0.2.0-alpha.38','checks':[],'passed':False}
original_mode=config.stat().st_mode & 0o777

def state(name=None):
 value=json.loads(subprocess.check_output([str(helper)]))
 if name:(work/(name+'.json')).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
 assert value['trusted'],'AX permission unavailable'
 return value

def wait_for(read,seconds=20):
 deadline=time.monotonic()+seconds
 while time.monotonic()<deadline:
  value=read()
  if value:return value
  time.sleep(.2)
 raise TimeoutError('Condition was not observed')

def text(value):
 return ' '.join(str(n.get(k,'')) for n in value.get('nodes',[]) for k in ('AXTitle','AXValue','AXDescription'))

def has_toast(value):
 return '自动保存失败，当前编辑仍保留在窗口中' in text(value)

def action(index,role,action):
 value=json.loads(subprocess.check_output([str(helper),'action',str(index),role,action]))
 assert value['actionStatus']==0,value

def screenshot(name):
 windows=json.loads(subprocess.check_output(['swift','/private/tmp/jianku-alpha36/windows.swift']))
 pid=state().get('pid')
 found=[w for w in windows['windows'] if w['pid']==pid and '编辑' in w['name']]
 if found:
  subprocess.run(['screencapture','-x','-l',str(found[0]['id']),str(work/name)],check=True)

try:
 assert 'pid' not in state(),'Preserve existing app; normal quit is required first'
 info=json.loads(subprocess.check_output(['plutil','-convert','json','-o','-',str(app/'Contents/Info.plist')]))
 assert info['CFBundleShortVersionString']=='0.2.0-alpha.38',info
 with (work/'review-app.log').open('ab') as log:
  process=subprocess.Popen([str(app/'Contents/MacOS/Jianku Screen Next'),str(project)],stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
 wait_for(lambda:next((n for n in state().get('nodes',[]) if n.get('AXRole')=='AXSlider' and n.get('AXValue')=='14'),None))
 before=config.read_bytes()
 current=state('ui-before'); sliders=[n for n in current['nodes'] if n.get('AXRole')=='AXSlider' and n.get('AXValue')=='14'];assert len(sliders)==1
 os.chmod(config,0o444)
 action(sliders[0]['index'],'AXSlider','AXIncrement')
 wait_for(lambda:has_toast(state()))
 assert config.read_bytes()==before
 current=state('ui-save-failed')
 changed=[n for n in current['nodes'] if n.get('AXRole')=='AXSlider' and n.get('AXValue')=='14.1'];assert changed
 report['checks'].append({'case':'readonly-autosave','passed':True,'originalBytesPreserved':True,'memoryPadding':14.1,'diskPadding':json.loads(config.read_text())['background']['padding']})
 screenshot('save-failure.png')
 time.sleep(9.2)
 assert has_toast(state('ui-toast-persisted'))
 report['checks'].append({'case':'persistent-error','passed':True,'waitSeconds':9.2})
 subprocess.check_call([str(helper),'quit'],stdout=subprocess.DEVNULL)
 time.sleep(7)
 current=state('ui-quit-blocked');assert current.get('pid')==process.pid
 assert config.read_bytes()==before
 report['checks'].append({'case':'quit-blocked-on-unsaved-config','passed':True,'originalBytesPreserved':True,'settleSeconds':7})
 os.chmod(config,original_mode)
 current=state()
 buttons=[n for n in current.get('nodes',[]) if n.get('AXRole')=='AXButton' and n.get('AXTitle') in ('好','确定','OK') and 'AXPress' in n.get('actions',[])]
 if len(buttons)==1:
  action(buttons[0]['index'],'AXButton','AXPress')
  time.sleep(.3)
 elif len(buttons)>1:raise RuntimeError('Ambiguous confirmation; inspect current window')
 subprocess.check_call([str(helper),'save'],stdout=subprocess.DEVNULL)
 wait_for(lambda:abs(json.loads(config.read_text())['background']['padding']-14.1)<1e-5)
 wait_for(lambda:not has_toast(state()))
 current=state('ui-save-retried')
 assert not list(project.glob('.project-config-*.json.tmp'))
 report['checks'].append({'case':'restore-permission-and-shortcut-retry','passed':True,'savedPadding':14.1,'toastCleared':True,'temporaryFiles':0})
 screenshot('save-retry.png')
 subprocess.check_call([str(helper),'quit'],stdout=subprocess.DEVNULL)
 wait_for(lambda:'pid' not in state())
 process.wait(timeout=10)
 report['checks'].append({'case':'normal-quit-after-retry','passed':True,'exitCode':process.returncode})
 report['configSha256']=hashlib.sha256(config.read_bytes()).hexdigest()
 report['passed']=True
except Exception as error:
 report['error']=str(error);report['traceback']=traceback.format_exc()
 try:state('ui-failed-state')
 except Exception:pass
 raise
finally:
 os.chmod(config,original_mode)
 (work/'interaction.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps(report,ensure_ascii=False,indent=2),flush=True)
