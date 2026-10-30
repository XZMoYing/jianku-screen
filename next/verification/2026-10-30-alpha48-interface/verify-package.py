import hashlib,json,plistlib,subprocess,sys
from pathlib import Path
root=Path(sys.argv[1]); version=sys.argv[2]; build=sys.argv[3]
info=plistlib.loads((root/'Contents/Info.plist').read_bytes())
assert info['CFBundleIdentifier']=='com.jianku.screen.next'
assert info['CFBundleShortVersionString']==version,(root,info['CFBundleShortVersionString'])
assert info['CFBundleVersion']==build
verified=subprocess.run(['codesign','--verify','--deep','--strict',str(root)],capture_output=True,text=True)
assert verified.returncode==0,verified.stderr
names=['Jianku Screen Next','cap-cli','cap-exporter','cap-muxer','jianku-device-capture','jianku-android-capture']
print(json.dumps({'path':str(root),'version':version,'build':build,'signature':'ad-hoc; strict deep verification passed','executables':{name:hashlib.sha256((root/'Contents/MacOS'/name).read_bytes()).hexdigest() for name in names}},ensure_ascii=False,indent=2))
