from pathlib import Path
import hashlib,json,os,plistlib,shutil,subprocess
r=Path('/Users/moyingxz/Documents/Zzx/05_项目开发/Jianku Screen Next');p=Path('/private/tmp/jianku-3d-integration')
commands=subprocess.check_output(['ps','-A','-o','comm='],text=True).splitlines()
assert not any(Path(v.strip()).name in {'cargo','rustc','cap-cli','cap-exporter'} for v in commands)
report={'removed':[],'beforeAvailableBytes':shutil.disk_usage(r).free,'current':'0.2.0-alpha.39','previous':'0.2.0-alpha.38','keptReleaseCacheForNextNativeWork':True}
for version in ('38','39'):
 bundle=r.parent/f'Jianku Screen Next Builds/0.2.0-alpha.{version}/Jianku Screen Next.app'
 subprocess.run(['codesign','--verify','--deep','--strict',str(bundle)],check=True)
old=r.parent/'Jianku Screen Next Builds/0.2.0-alpha.37/Jianku Screen Next.app'
staging=Path('/Applications/.jianku-next-update-rYzRFl')
assert set(x.name for x in staging.iterdir())=={'previous.app'}
old37=json.loads((r/'next/verification/2026-10-26-alpha37-localization-preview/delivery.json').read_text())['bundles'][2]['mainSha256']
old38=json.loads((r/'next/verification/2026-10-27-alpha38-safe-save/delivery.json').read_text())['bundles'][2]['binaries']['Jianku Screen Next']
for bundle,version,expected in [(old,'0.2.0-alpha.37',old37),(staging/'previous.app','0.2.0-alpha.38',old38)]:
 with (bundle/'Contents/Info.plist').open('rb') as f:info=plistlib.load(f)
 assert info['CFBundleIdentifier']=='com.jianku.screen.next' and info['CFBundleShortVersionString']==version
 subprocess.run(['codesign','--verify','--deep','--strict',str(bundle)],check=True)
 actual=hashlib.sha256((bundle/'Contents/MacOS/Jianku Screen Next').read_bytes()).hexdigest();assert actual==expected
 size=sum(f.stat().st_size for f in bundle.rglob('*') if f.is_file() and not f.is_symlink())
 report['removed'].append({'path':str(bundle),'version':version,'mainSha256':actual,'logicalBytes':size})
 shutil.rmtree(bundle)
staging.rmdir()
base_names=['flat','static','disabled','motion','combined','static-focus','motion-focus']
spring_names=base_names+['natural-motion','natural-combined','natural-focus','natural-sharp','natural-split-sharp']
for directory,names,keep in [
 (Path('/private/tmp/jianku-3d-final'),[f'{phase}-{name}.mp4' for phase in ['before','after'] for name in base_names],{'before-motion.mp4','after-motion.mp4'}),
 (Path('/private/tmp/jianku-3d-spring/fixtures'),[f'{phase}-{name}.mp4' for phase in ['before','after'] for name in spring_names],{'before-natural-motion.mp4','after-natural-motion.mp4'}),
 (p,[f'{phase}-{name}-{fps}.mp4' for phase in ['before','after'] for name in ['whole','aligned','offgrid','hardcut'] for fps in [30,60,120]]+['package-ui.mp4','package-offgrid.mp4','framing-center.mp4','framing-perspective.mp4'],{'before-offgrid-60.mp4','after-offgrid-60.mp4','before-whole-60.mp4','after-whole-60.mp4'}),
]:
 for name in names:
  f=directory/name
  if name in keep or not f.exists():continue
  assert f.is_file() and not f.is_symlink()
  report['removed'].append({'path':str(f),'logicalBytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()})
  f.unlink()
report['afterAvailableBytes']=shutil.disk_usage(r).free
report['availableByteDelta']=report['afterAvailableBytes']-report['beforeAvailableBytes']
report['logicalBytesRemoved']=sum(x['logicalBytes'] for x in report['removed'])
report['preserved']='All projects/media inside .jks, current/previous applications, representative before/after movies, source/Git, native libraries, immediate next-stage build cache, raw/archived diagnostic reports'
(p/'cleanup.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='removed'},ensure_ascii=False,indent=2))
