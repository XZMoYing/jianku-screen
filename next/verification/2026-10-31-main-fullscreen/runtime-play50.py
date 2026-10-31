import json,re,subprocess,time,plistlib
from pathlib import Path
area=Path('/private/tmp/jianku-picker-menus-20261031')
helper='/private/tmp/jianku-fullscreen-native/ax-control-geometry'
app=Path('/Applications/Jianku Screen Next.app')
fixture=area/'首页与全屏验收.jks'
rows=[]
def state():
 assert plistlib.loads((app/'Contents/Info.plist').read_bytes())['CFBundleShortVersionString']=='0.2.0-alpha.50'
 d=json.loads(subprocess.check_output([helper],text=True))
 assert d.get('trusted') is True and d.get('path')==str(app) and d.get('ownedEditorWindowCount')==1
 return d
def nodes(d,label):
 return [n for n in d['nodes'] if (n.get('AXTitle') or n.get('AXDescription'))==label and 'AXPress' in n.get('actions',[])]
def press(label):
 d=state();ns=nodes(d,label);assert len(ns)==1,(label,ns)
 n=ns[0];v=json.loads(subprocess.check_output([helper,'action',str(n['index']),n['AXRole'],'AXPress'],text=True));assert v['actionStatus']==0
 return v
def wait_value(label,value):
 deadline=time.monotonic()+8
 while time.monotonic()<deadline:
  found=nodes(state(),label)
  if len(found)==1 and found[0].get('AXValue')==value:return
  time.sleep(.1)
 raise RuntimeError('Control did not settle: '+label+'='+value)
def seconds(d):
 codes=[n.get('AXValue','') for n in d['nodes'] if n.get('AXRole')=='AXStaticText' and re.fullmatch(r'\d+:\d{2}\.\d{2}',n.get('AXValue',''))]
 assert len(codes)>=2,codes
 m,s=codes[0].split(':');return 60*int(m)+float(s),codes[:2]
def sample(stage):
 d=state();value,codes=seconds(d);play=nodes(d,'播放/暂停视频');assert len(play)==1
 row={'stage':stage,'timecodes':codes,'seconds':value,'playing':play[0].get('AXValue')}
 rows.append(row);(area/'runtime-play50-results.json').write_text(json.dumps({'version':'0.2.0-alpha.50','fixture':'own synthetic media','rows':rows},ensure_ascii=False,indent=2)+'\n')
 print(row,flush=True);return row
for cycle in range(3):
 d=state();play=nodes(d,'播放/暂停视频');assert len(play)==1
 if play[0].get('AXValue')=='1':
  press('播放/暂停视频')
  wait_value('播放/暂停视频','0')
 press('回到开头')
 time.sleep(.3);r=sample('rewound-'+str(cycle));assert r['seconds']<=.05,r
 press('播放/暂停视频')
 values=[]
 for i in range(5):
  time.sleep(.9);values.append(sample('playing-'+str(cycle)))
 assert values[-1]['seconds']>values[0]['seconds']+2,values
 assert values[-1]['playing']=='1',values
 press('播放/暂停视频')
 wait_value('播放/暂停视频','0')
 paused=sample('paused-'+str(cycle));assert paused['playing']=='0',paused
press('回到开头')
sample('final-paused-at-start')
