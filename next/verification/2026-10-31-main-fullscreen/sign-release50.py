from pathlib import Path
import subprocess,plistlib
root=Path.cwd();app=root/'target/release/bundle/macos/Jianku Screen Next.app'
info=plistlib.loads((app/'Contents/Info.plist').read_bytes());assert info['CFBundleIdentifier']=='com.jianku.screen.next' and info['CFBundleShortVersionString']=='0.2.0-alpha.50'
for f in app.rglob('*.cstemp'):
 assert f.is_file();f.unlink()
def sign(*args):subprocess.run(['codesign','--force','--sign','-',*map(str,args)],check=True,timeout=60)
sign('--identifier','com.jianku.screen.next.devicecapture',app/'Contents/MacOS/jianku-device-capture')
for framework in sorted(app.rglob('*.framework'),key=lambda p:len(p.parts),reverse=True):
 if framework.is_dir():sign(framework)
sign('--identifier','com.jianku.screen.next','--entitlements',root/'apps/desktop/src-tauri/Entitlements.plist',app)
subprocess.run(['codesign','--verify','--deep','--strict',str(app)],check=True,timeout=60)
print('Release alpha50 signed ad-hoc and strict deep verification passed')
