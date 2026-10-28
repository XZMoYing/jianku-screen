from pathlib import Path
import hashlib,json,subprocess,sys
import ui
w=Path('/private/tmp/jianku-preview-interaction')
project=Path('/Users/moyingxz/Documents/Zzx/05_项目开发/Jianku Screen Next Builds/0.2.0-alpha.41/预览清晰度与自然运镜示例.jks')
assert json.loads((project/'.jianku-preview-resolution-fixture.json').read_text())=={'kind':'jianku-preview-resolution','version':1}
before=hashlib.sha256((project/'project-config.json').read_bytes()).hexdigest()
checks=[]
for quality,label,x,y in [
 ('144p','144p',256,144),('360p','360p',640,360),('480p','480p',856,480),('540p','540p',960,540),
 ('720p','720p',1280,720),('1080p','1080p',1920,1080),('1440p','2K（1440p）',2560,1440),('2160p','4K（2160p）',3840,2160),('original','原始清晰度',4272,2402),
]:
 s=ui.state()
 if not any(n.get('AXRole')=='AXList' and n.get('AXDescription')=='预览清晰度' for n in s['nodes']):
  n=next(n for n in s['nodes'] if n.get('AXRole')=='AXPopUpButton' and n.get('AXDescription','').startswith('预览清晰度 '))
  ui.click(AXRole=n['AXRole'],AXDescription=n['AXDescription'])
 s=ui.state('menu-before-'+quality)
 title=f'{label} {x} × {y}'
 n=next(n for n in s['nodes'] if n.get('AXTitle')==title);assert n['AXEnabled']=='1',n
 ui.click(AXRole=n['AXRole'],AXTitle=title)
 ui.wait(lambda: any(n.get('AXDescription')=='预览清晰度 '+label for n in ui.state().get('nodes',[])))
 ui.state('selected-'+quality)
 subprocess.run(['node',str(w/'capture-preview.mjs'),'0.2.0-alpha.41',str(w/('selected-'+quality+'-frame.json')),str(x),str(y)],check=True,stdout=subprocess.DEVNULL)
 stored=json.loads(Path('/Users/moyingxz/Library/Application Support/com.jianku.screen.next/store').read_text())['general_settings']['editorPreviewQuality'];assert stored==quality,(stored,quality)
 checks.append({'quality':quality,'label':label,'actualSize':[x,y],'realPointerMenuSelection':True,'stored':stored,'passed':True})
 print(json.dumps(checks[-1],ensure_ascii=False),flush=True)
assert hashlib.sha256((project/'project-config.json').read_bytes()).hexdigest()==before
(w/'all-menu-options.json').write_text(json.dumps({'checks':checks,'projectConfigSha256Unchanged':before,'passed':True},ensure_ascii=False,indent=2)+'\n')
