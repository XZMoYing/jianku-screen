import hashlib
import json
import os
import plistlib
import subprocess
import sys
import uuid
from pathlib import Path

area = Path('/private/tmp/jianku-alpha57-20261104')
flag = Path.home() / 'Library/Application Support/com.jianku.screen.next/timeline-gesture-diagnostics.enabled'
journal_path = area / 'diagnostic-flag-journal.json'
app = Path('/Applications/Jianku Screen Next.app')
info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
version = info.get('CFBundleShortVersionString')
commands = subprocess.check_output(['ps', '-axo', 'comm='], text=True).splitlines()
running = any(row.strip().endswith('/Contents/MacOS/Jianku Screen Next') for row in commands)
mode = sys.argv[1] if len(sys.argv) > 1 else 'status'


def save(value):
    journal_path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    journal_path.chmod(0o600)


def digest():
    assert flag.is_file() and not flag.is_symlink(), 'Diagnostic flag must be a regular file'
    return hashlib.sha256(flag.read_bytes()).hexdigest()


if mode == 'status':
    print(json.dumps({'installedVersion': version, 'productRunning': running, 'flagPresent': flag.exists(), 'ownershipJournalPresent': journal_path.exists()}))
elif mode in ['enable', 'disable']:
    if running:
        raise SystemExit('Normally exit all product instances before changing the diagnostic flag.')
    if mode == 'enable':
        if version != '0.2.0-alpha.57':
            raise SystemExit('Install and verify alpha57 before enabling this diagnostic.')
        assert flag.parent.is_dir() and not flag.is_symlink()
        if flag.exists():
            assert journal_path.exists(), 'Preserve an existing flag without an ownership journal'
            journal = json.loads(journal_path.read_text())
            assert journal['path'] == str(flag) and journal['createdByThisRun'] and journal['sha256'] == digest()
            print('This run already owns the unchanged diagnostic flag.')
        else:
            token = ('jianku-alpha57-native-drag:' + str(uuid.uuid4()) + '\n').encode()
            fd = os.open(flag, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'wb') as stream:
                stream.write(token)
            save({'path': str(flag), 'createdByThisRun': True, 'sha256': digest(), 'disabled': False})
            print('Enabled local diagnostic for new alpha57 windows.')
    else:
        assert journal_path.exists(), 'No ownership journal; preserve the diagnostic flag'
        journal = json.loads(journal_path.read_text())
        assert journal['path'] == str(flag) and journal['createdByThisRun']
        if flag.exists():
            assert digest() == journal['sha256'], 'Flag changed; preserve it'
            flag.unlink()
        journal['disabled'] = True
        save(journal)
        print('Removed only this run\'s unchanged diagnostic flag; product is closed.')
else:
    raise SystemExit('Use status, enable or disable.')
