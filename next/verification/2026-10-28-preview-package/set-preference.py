from pathlib import Path
import argparse
import json
import os
import plistlib
import subprocess
import tempfile
import time
parser=argparse.ArgumentParser()
parser.add_argument('quality',choices=['half','144p','360p','480p','540p','720p','1080p','1440p','2160p','original'])
parser.add_argument('project',choices=['small','large'])
args=parser.parse_args()
work=Path('/private/tmp/jianku-preview-package')
project=work/(args.project+'.jks')
assert json.loads((project/'.jianku-preview-resolution-fixture.json').read_text())=={'kind':'jianku-preview-resolution','version':1}
app=Path('/Applications/Jianku Screen Next.app')
with (app/'Contents/Info.plist').open('rb') as f:assert plistlib.load(f)['CFBundleShortVersionString']=='0.2.0-alpha.41'
helper=work/'ax-control'
s=json.loads(subprocess.check_output([str(helper)]));assert s['trusted']
if 'pid' in s:
 assert s['path']==str(app)
 result=json.loads(subprocess.check_output([str(helper),'quit']));assert result['normalQuitRequested']
 end=time.monotonic()+25
 while 'pid' in json.loads(subprocess.check_output([str(helper)])):
  if time.monotonic()>end:raise SystemExit('Normal quit incomplete; preference left unchanged')
  time.sleep(.25)
p=Path('/Users/moyingxz/Library/Application Support/com.jianku.screen.next/store')
value=json.loads(p.read_text());settings=value.setdefault('general_settings',{})
baseline=work/'preference-baseline.json'
if not baseline.exists():baseline.write_text(json.dumps({'present':'editorPreviewQuality' in settings,'quality':settings.get('editorPreviewQuality')})+'\n')
settings['editorPreviewQuality']=args.quality
mode=p.stat().st_mode & 0o777
with tempfile.NamedTemporaryFile(mode='w',encoding='utf8',prefix='.jianku-preview-qa-',dir=p.parent,delete=False) as f:
 temp=Path(f.name)
 try:
  os.chmod(temp,mode)
  json.dump(value,f,ensure_ascii=False);f.write('\n');f.flush();os.fsync(f.fileno());os.replace(temp,p)
 finally:
  if temp.exists():temp.unlink()
subprocess.run(['open','-a',str(app),str(project)],check=True)
print(json.dumps({'quality':args.quality,'project':args.project,'normalQuitBeforePreferenceWrite':True,'otherStoreFieldsPreserved':True}))
