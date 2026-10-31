from pathlib import Path
import json,subprocess,shutil
area=Path('/private/tmp/jianku-picker-menus-20261031')
base=Path('/Users/moyingxz/Documents/Zzx/05_项目开发/Jianku Screen Next Builds')
verify='/private/tmp/jianku-alpha48/verify-package.py'
def check(path,version,build):return json.loads(subprocess.check_output(['python3',verify,str(path),version,build],text=True))
installed=check(Path('/Applications/Jianku Screen Next.app'),'0.2.0-alpha.50','2026.50.0')
assert installed['executables']==json.loads((area/'package-archive.json').read_text())['executables']
rollback=check(base/'0.2.0-alpha.49/Jianku Screen Next.app','0.2.0-alpha.49','2026.49.0')
previous=Path('/Applications/.jianku-next-update-8mTlkM/previous.app')
assert check(previous,'0.2.0-alpha.49','2026.49.0')['executables']==rollback['executables']
old=base/'0.2.0-alpha.48/Jianku Screen Next.app'
old_proof=check(old,'0.2.0-alpha.48','2026.48.0')
before=shutil.disk_usage(base).free
removed=[]
for path in [old,previous]:
 size=sum(f.stat().st_size for f in path.rglob('*') if f.is_file() and not f.is_symlink())
 allocated_kib=int(subprocess.check_output(['du','-sk',str(path)],text=True).split()[0])
 shutil.rmtree(path)
 removed.append({'path':str(path),'logicalBytes':size,'allocatedKiB':allocated_kib})
 if not any(path.parent.iterdir()):path.parent.rmdir()
after=shutil.disk_usage(base).free
out={'removed':removed,'freeBytesBefore':before,'freeBytesAfter':after,'observedFreeDeltaBytes':after-before,'kept':['installed alpha50','archive alpha50','rollback archive alpha49','source/Git','user projects/media','active synthetic fixture','native dependencies/build caches'],'oldAlpha48Proof':old_proof,'duplicateAlpha49MatchedRetainedRollback':True,'note':'APFS sharing and concurrent activity mean logical/allocated sizes are not equal to observed volume free-space delta'}
(area/'cleanup50.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'removedApps':len(removed),'observedFreeDeltaGiB':round((after-before)/1024**3,3),'freeGiB':round(after/1024**3,2)},ensure_ascii=False))
