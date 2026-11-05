import json
import os
import plistlib
import shutil
import subprocess
from pathlib import Path

builds = Path('/Users/moyingxz/Documents/Zzx/05_项目开发/Jianku Screen Next Builds')
area = Path('/private/tmp/jianku-alpha59-20261105')
verifier = Path(__file__).with_name('verify-package.py')


def verify(app, number):
    return json.loads(subprocess.check_output(['python3', str(verifier), str(app), f'0.2.0-alpha.{number}', f'2026.{number}.0'], text=True))


current = verify(Path('/Applications/Jianku Screen Next.app'), 59)
archive = verify(builds / '0.2.0-alpha.59/Jianku Screen Next.app', 59)
assert current['executables'] == archive['executables']
verify(builds / '0.2.0-alpha.58/Jianku Screen Next.app', 58)
verify(builds / '0.2.0-alpha.54/Jianku Screen Next.app', 54)
commands = subprocess.check_output(['ps', '-axo', 'comm='], text=True).splitlines()
removed = []
skipped = []
free_before = os.statvfs('/System/Volumes/Data').f_bavail * os.statvfs('/System/Volumes/Data').f_frsize


def remove_app(app):
    assert app.is_dir() and not app.is_symlink()
    assert not any(command.strip().startswith(str(app) + '/') for command in commands)
    size = int(subprocess.check_output(['du', '-sk', str(app)], text=True).split()[0]) * 1024
    shutil.rmtree(app)
    removed.append({'path': str(app), 'logicalAllocatedBytes': size})


for folder in sorted(Path('/Applications').glob('.jianku-next-update5*')):
    if folder.is_symlink():
        continue
    old = folder / 'previous.app'
    if not old.is_dir():
        continue
    info = plistlib.loads((old / 'Contents/Info.plist').read_bytes())
    version = info.get('CFBundleShortVersionString')
    number = next((number for number in [54, 55, 56, 57] if version == f'0.2.0-alpha.{number}'), None)
    if number is None:
        continue
    try:
        saved = verify(builds / f'0.2.0-alpha.{number}/Jianku Screen Next.app', number)
        duplicate = verify(old, number)
        assert saved['executables'] == duplicate['executables']
        remove_app(old)
    except (AssertionError, subprocess.CalledProcessError, OSError) as error:
        skipped.append({'path': str(old), 'reason': type(error).__name__})
for number in [53, 55, 56]:
    app = builds / f'0.2.0-alpha.{number}/Jianku Screen Next.app'
    if app.is_dir():
        verify(app, number)
        remove_app(app)
free_after = os.statvfs('/System/Volumes/Data').f_bavail * os.statvfs('/System/Volumes/Data').f_frsize
report = {'retainedAppArchives': [54, 57, 58, 59], 'scope': 'verified duplicate previous.app slots and obsolete app bundles only; project media, verification evidence, dependencies and Git retained', 'removed': removed, 'skipped': skipped, 'sumRemovedAllocatedBytes': sum(row['logicalAllocatedBytes'] for row in removed), 'observedVolumeFreeChangeBytes': free_after - free_before, 'volumeChangeMayIncludeOtherSystemActivity': True}
(area / 'cleanup-results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(report, ensure_ascii=False))
