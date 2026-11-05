import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

area = Path('/private/tmp/jianku-alpha73-20261106')
source = Path.cwd() / 'target/release/bundle/macos/Jianku Screen Next.app'
archive = Path('/Users/moyingxz/Documents/Zzx/05_项目开发/Jianku Screen Next Builds/0.2.0-alpha.73/Jianku Screen Next.app')
installed = Path('/Applications/Jianku Screen Next.app')
verifier = Path(__file__).with_name('verify-package.py')


def verify(app, version='0.2.0-alpha.73', build='2026.73.0'):
    return json.loads(subprocess.check_output(['python3', str(verifier), str(app), version, build], text=True))


def save(name, data):
    (area / f'{name}.json').write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')


mode = sys.argv[1]
if mode == 'prepare':
    assert subprocess.check_output(['git', 'diff', '--name-only', json.loads((area / 'build-source.json').read_text())['commit'], '--', '.'], text=True).strip() == '', 'Product inputs changed during release'
    a = verify(source)
    assert not archive.parent.exists(), 'Refuse to overwrite an archive'
    archive.parent.mkdir()
    subprocess.run(['ditto', str(source), str(archive)], check=True)
    b = verify(archive)
    assert a['executables'] == b['executables']
    save('package-source', a)
    save('package-archive', b)
    rollback = verify(installed, '0.2.0-alpha.72', '2026.72.0')
    expected = json.loads((area / 'rollback-archive.json').read_text())
    assert rollback['executables'] == expected['executables']
    staging = Path(tempfile.mkdtemp(prefix='.jianku-next-update73-', dir='/Applications'))
    incoming = staging / 'incoming.app'
    subprocess.run(['ditto', str(archive), str(incoming)], check=True)
    assert verify(incoming)['executables'] == b['executables']
    save('install-journal', {'staging': str(staging), 'expected': b['executables'], 'rollback': rollback['executables']})
    print('Source, archive and staged candidate signatures, versions and six binaries match.')
elif mode == 'install':
    running = subprocess.check_output(['/bin/ps', '-axo', 'command='], text=True).splitlines()
    executable = str(installed / 'Contents/MacOS/Jianku Screen Next')
    assert not any(row.strip() == executable or row.strip().startswith(executable + ' ') for row in running), 'Own app is still running; normal quit is required'
    journal = json.loads((area / 'install-journal.json').read_text())
    staging = Path(journal['staging'])
    assert staging.parent == Path('/Applications') and staging.name.startswith('.jianku-next-update73-')
    incoming, previous = staging / 'incoming.app', staging / 'previous.app'
    assert verify(incoming)['executables'] == journal['expected']
    assert verify(installed, '0.2.0-alpha.72', '2026.72.0')['executables'] == journal['rollback']
    assert not previous.exists()
    os.rename(installed, previous)
    try:
        os.rename(incoming, installed)
        result = verify(installed)
        assert result['executables'] == journal['expected']
    except BaseException:
        if installed.exists():
            os.rename(installed, incoming)
        os.rename(previous, installed)
        raise
    save('package-installed', result)
    print('Installed alpha73; verified alpha72 remains in archive and temporary rollback slot.')
else:
    raise ValueError('Expected prepare or install')
