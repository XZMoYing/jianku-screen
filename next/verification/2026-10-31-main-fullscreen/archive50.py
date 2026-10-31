import json,subprocess
from pathlib import Path
area=Path('/private/tmp/jianku-picker-menus-20261031')
source=Path.cwd()/'target/release/bundle/macos/Jianku Screen Next.app'
archive=Path('/Users/moyingxz/Documents/Zzx/05_项目开发/Jianku Screen Next Builds/0.2.0-alpha.50/Jianku Screen Next.app')
assert not archive.parent.exists(),'Refuse to overwrite existing alpha50 archive'
assert subprocess.check_output(['git','diff','--name-only','6a2f03a','--','.'],text=True).strip()=='','Product source changed since native build freeze'
def verify(app):
 return json.loads(subprocess.check_output(['python3','/private/tmp/jianku-alpha48/verify-package.py',str(app),'0.2.0-alpha.50','2026.50.0'],text=True))
a=verify(source);archive.parent.mkdir();subprocess.run(['ditto',str(source),str(archive)],check=True);b=verify(archive)
assert a['executables']==b['executables']
for name,data in [('package-source',a),('package-archive',b)]:area.joinpath(name+'.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
print('alpha50 source and archive: strict signatures/version and six executable hashes match',flush=True)
