import copy
import hashlib
import json
import math
import plistlib
import subprocess
import sys
import time
from pathlib import Path

area = Path('/private/tmp/jianku-alpha57-20261104')
app = Path('/Applications/Jianku Screen Next.app')
project = area / '3D拖动.jks'
title = json.loads((project / 'recording-meta.json').read_text())['pretty_name']
kind = sys.argv[1]
assert kind in ['move', 'start', 'end']
assert plistlib.loads((app / 'Contents/Info.plist').read_bytes())['CFBundleShortVersionString'] == '0.2.0-alpha.57'


def control(*args):
    result = subprocess.run([str(area / 'editor-ax'), *args], capture_output=True, text=True, timeout=20)
    assert result.returncode == 0, args
    return json.loads(result.stdout)


def ready():
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        state = control()
        if state.get('ownedEditorWindowCount') == 1 and any(n.get('AXRole') == 'AXTextField' and n.get('AXValue') == title for n in state['nodes']):
            return state
        time.sleep(0.2)
    raise RuntimeError('Expected owned 3D editor did not become ready')


def items():
    return json.loads((project / 'project-config.json').read_text())['timeline']['camera3dSegments']


def save():
    ready()
    assert control('save').get('saveKeySent')
    ready()


def wait_for(predicate):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(0.1)
    raise RuntimeError('Expected saved 3D state was not reached')


def motion(segment):
    value = copy.deepcopy(segment)
    duration = value.pop('end') - value.pop('start')
    for frames in value['tracks'].values():
        for frame in frames:
            frame['time'] /= duration

    def rounded(item):
        if isinstance(item, float):
            assert math.isfinite(item)
            return round(item, 9)
        if isinstance(item, dict):
            return {key: rounded(val) for key, val in item.items()}
        if isinstance(item, list):
            return [rounded(val) for val in item]
        return item

    return rounded(value)


ready()
save()
before = items()
assert [(r['start'], r['end']) for r in before] == [(2, 6), (10, 14)]
state = ready()
nodes = state['nodes']
groups = [(i, n) for i, n in enumerate(nodes) if n.get('AXRole') == 'AXGroup' and '3D' in n.get('AXHelp', '') and n.get('size', {}).get('height') == 44]
assert len(groups) >= 2
i, group = min(groups, key=lambda row: row[1]['position']['x'])
descendants = []
for node in nodes[i + 1:]:
    if node['depth'] <= group['depth']:
        break
    descendants.append(node)
markers = [n for n in descendants if n.get('AXRole') == 'AXGroup' and n.get('size', {}).get('width', 999) <= 5 and n.get('size', {}).get('height', 0) >= 14]
markers.sort(key=lambda n: n['position']['x'])
bounds = state['bounds']
if kind == 'move':
    x, y = group['position']['x'] + 50, group['position']['y'] + 22
else:
    assert len(markers) == 2, markers
    marker = markers[0 if kind == 'start' else 1]
    x = marker['position']['x'] + marker['size']['width'] / 2
    y = marker['position']['y'] + marker['size']['height'] / 2
buttons = [n for n in nodes if n.get('AXRole') == 'AXPopUpButton' and n.get('AXTitle') in ['添加轨道', 'Add track']]
assert len(buttons) == 1
top = buttons[0]['position']['y']
ruler = {n['AXValue']: n['position']['x'] for n in nodes if n.get('AXRole') == 'AXStaticText' and n.get('AXValue') in ['0:02', '0:03'] and abs(n['position']['y'] - top) < 25}
assert set(ruler) == {'0:02', '0:03'}
seconds = 81 / (ruler['0:03'] - ruler['0:02'])
assert control('focus-window', '0').get('selectedWindowFocused')
log = area / f'three-d-{kind}-gesture.log'
assert not log.exists()
with log.open('w') as stream:
    result = subprocess.run([str(area / 'drag-owned'), str(state['windowID']), str(x - bounds['X']), str(y - bounds['Y']), str(x - bounds['X'] + 81), str(y - bounds['Y']), '16', '0.9', 'normal', 'raw'], stdout=stream, stderr=subprocess.STDOUT, timeout=25)
assert result.returncode == 0
save()
expected = [2 + (seconds if kind != 'end' else 0), 6 + (seconds if kind != 'start' else 0)]

def moved():
    after = items()
    return after if all(abs(after[0][key] - value) < 0.02 for key, value in zip(['start', 'end'], expected)) else None

after = wait_for(moved)
assert after[1] == before[1]
assert motion(after[0]) == motion(before[0])
assert control('history', 'undo').get('actionStatus') == 0
save()
wait_for(lambda: items() == before)
path = area / 'three-d-native-results.json'
rows = json.loads(path.read_text()) if path.exists() else []
row = {'case': kind, 'passed': True, 'actualRange': [after[0]['start'], after[0]['end']], 'otherShotPreserved': True, 'normalizedMotionAndBlurPreserved': True, 'undoRestored': True, 'motionSHA256': hashlib.sha256(json.dumps(motion(before[0]), sort_keys=True).encode()).hexdigest()}
rows.append(row)
path.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(row, ensure_ascii=False))
