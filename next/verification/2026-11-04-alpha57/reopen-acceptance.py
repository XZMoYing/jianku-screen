import json
import subprocess
import time
from pathlib import Path

area = Path('/private/tmp/jianku-alpha57-20261104')
app = '/Applications/Jianku Screen Next.app'
helper = area / 'editor-ax'
flag = Path.home() / 'Library/Application Support/com.jianku.screen.next/timeline-gesture-diagnostics.enabled'
assert not flag.exists()


def control(*args):
    result = subprocess.run([str(helper), *args], capture_output=True, text=True, timeout=20, check=True)
    return json.loads(result.stdout)


def ready(title):
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        state = control()
        if state.get('ownedEditorWindowCount') == 1:
            titles = [node.get('AXValue') for node in state['nodes'] if node.get('AXRole') == 'AXTextField']
            assert title in titles, 'Preserve an unexpected editor'
            return state
        time.sleep(0.2)
    raise RuntimeError('Expected owned editor was not observed')


assert not control().get('ownedEditorWindowCount')
rows = []
for name in ['按键拖动', '3D拖动']:
    project = area / (name + '.jks')
    title = json.loads((project / 'recording-meta.json').read_text())['pretty_name']
    config = json.loads((project / 'project-config.json').read_text())
    segments = config['timeline']['keyboardSegments' if name == '按键拖动' else 'camera3dSegments']
    edited = segments[1 if name == '按键拖动' else 0]
    assert edited['start'] == 2 and abs(edited['end'] - 6.998903312444047) < 1e-8
    for repetition in range(2):
        subprocess.run(['open', '-a', app, str(project)], check=True)
        state = ready(title)
        assert control('save')['saveKeySent']
        time.sleep(0.4)
        assert json.loads((project / 'project-config.json').read_text()) == config
        rows.append({'case': name, 'repetition': repetition + 1, 'passed': True, 'fullConfigPreservedAfterNativeReopen': True, 'diagnosticFlagAbsent': not flag.exists()})
        (area / 'reopen-final-results.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps(rows[-1], ensure_ascii=False), flush=True)
        if name != '3D拖动' or repetition == 0:
            assert control('close-synthetic')['actionStatus'] == 0
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline and control().get('ownedEditorWindowCount'):
                time.sleep(0.2)
            assert not control().get('ownedEditorWindowCount')
