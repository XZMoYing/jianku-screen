import json
import math
import plistlib
import subprocess
import sys
import time
from pathlib import Path

area = Path('/private/tmp/jianku-alpha57-20261104')
app = Path('/Applications/Jianku Screen Next.app')
project = area / '按键拖动.jks'
helper = area / 'editor-ax'
title = json.loads((project / 'recording-meta.json').read_text())['pretty_name']
report_path = area / 'keyboard-native-results.json'
action, model = sys.argv[1:3]
assert action in ['move', 'start', 'end', 'undo', 'history', 'blur'] and model in ['raw', 'clean']
info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
assert info['CFBundleShortVersionString'] == '0.2.0-alpha.57'


def control(*args):
    result = subprocess.run([str(helper), *args], capture_output=True, text=True, timeout=20)
    assert result.returncode == 0, f'Owned request rejected: {args}'
    return json.loads(result.stdout)


def ready():
    state = control()
    assert state.get('ownedEditorWindowCount') == 1
    assert any(node.get('AXRole') == 'AXTextField' and node.get('AXValue') == title for node in state['nodes'])
    return state


def items():
    return json.loads((project / 'project-config.json').read_text())['timeline']['keyboardSegments']


def wait_for(predicate):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(0.1)
    raise RuntimeError('Expected native state was not reached')


def save():
    ready()
    assert control('save').get('saveKeySent')
    ready()


def record(row):
    results = json.loads(report_path.read_text()) if report_path.exists() else []
    results.append(row)
    report_path.write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(row, ensure_ascii=False))


state = ready()
if action in ['move', 'start', 'end', 'history', 'blur']:
    save()
    before = items()
    assert [(row['start'], row['end']) for row in before] == [(70, 74), (2, 6), (10, 14)]
    baseline = area / 'keyboard-native-baseline.json'
    if not baseline.exists():
        baseline.write_text(json.dumps(before, ensure_ascii=False, indent=2) + '\n')
    else:
        assert json.loads(baseline.read_text()) == before
    state = ready()
    labels = [node for node in state['nodes'] if node.get('AXRole') == 'AXStaticText' and node.get('AXValue') == '按键A']
    assert len(labels) == 1
    label, bounds = labels[0], state['bounds']
    x = label['position']['x'] + label['size']['width'] / 2 - bounds['X']
    y = label['position']['y'] + label['size']['height'] / 2 - bounds['Y']
    if action in ['start', 'end']:
        groups = [(index, node) for index, node in enumerate(state['nodes']) if node.get('AXRole') == 'AXGroup' and node.get('AXHelp') == '按键A']
        assert len(groups) == 1
        index, group = groups[0]
        descendants = []
        for node in state['nodes'][index + 1:]:
            if node['depth'] <= group['depth']:
                break
            descendants.append(node)
        markers = [node for node in descendants if node.get('AXRole') == 'AXGroup' and node.get('size', {}).get('width') == 4 and node.get('size', {}).get('height') == 16]
        markers.sort(key=lambda node: node['position']['x'])
        assert len(markers) == 2
        marker = markers[0 if action == 'start' else 1]
        x = marker['position']['x'] + 2 - bounds['X']
        y = marker['position']['y'] + 8 - bounds['Y']
    assert control('focus-window', '0').get('selectedWindowFocused')
    started = int(time.time() * 1000)
    log = area / (f'keyboard-{model}-gesture.log' if action == 'move' else f'keyboard-{action}-{model}-gesture.log')
    assert not log.exists(), 'Preserve the existing gesture evidence'
    with log.open('w') as stream:
        result = subprocess.run([str(area / 'drag-owned'), str(state['windowID']), str(x), str(y), str(x + 81), str(y), '16', '0.9', {'move': 'normal', 'start': 'normal', 'end': 'normal', 'history': 'undo', 'blur': 'blur'}[action], model], stdout=stream, stderr=subprocess.STDOUT, timeout=25)
    assert result.returncode == 0

    def new_event():
        for path in (Path.home() / 'Library/Application Support/com.jianku.screen.next').glob('timeline-gesture-diagnostics-editor-*.json'):
            for row in reversed(json.loads(path.read_text()).get('records', [])):
                if row['startedAt'] >= started and row['kind'] == 'keyboard':
                    return row
        return None

    event = wait_for(new_event)
    assert event['cause'] in ({'move': ['release'], 'start': ['release'], 'end': ['release'], 'history': ['history'], 'blur': ['blur', 'release']}[action]), event
    assert event['moves'] >= 2, event
    scale = event['snapshot']['initialScale']
    assert math.isfinite(scale) and scale > 0
    assert math.isfinite(event['snapshot']['currentScale'])
    if action == 'move':
        expected = [2 + 81 * scale, 6 + 81 * scale]
    elif action in ['start', 'end']:
        expected = [2 + (81 * scale if action == 'start' else 0), 6 + (81 * scale if action == 'end' else 0)]
    elif action == 'history':
        expected = [2, 6]
    else:
        expected = [event['snapshot']['start'], event['snapshot']['end']]
        assert 0 < expected[0] - 2 < 81 * scale * 0.75
    save()

    def moved():
        current = items()
        return current if all(abs(current[1][key] - value) < 1e-8 for key, value in zip(['start', 'end'], expected)) else None

    after = wait_for(moved)
    assert after[0] == before[0] and after[2] == before[2]
    assert {k: v for k, v in after[1].items() if k not in ['start', 'end']} == {k: v for k, v in before[1].items() if k not in ['start', 'end']}
    record({'model': model, 'phase': action, 'passed': True, 'range': expected, 'diagnostic': event, 'otherSourceItemsPreserved': True})
    if action in ['history', 'blur']:
        if action == 'history':
            assert control('history', 'redo').get('actionStatus') == 0
            save()
            expected = [event['snapshot']['start'], event['snapshot']['end']]
            wait_for(moved)
        assert control('history', 'undo').get('actionStatus') == 0
        save()
        baseline = json.loads((area / 'keyboard-native-baseline.json').read_text())
        wait_for(lambda: items() == baseline)
        record({'model': model, 'phase': action + '-restored', 'passed': True, 'tailEventsIgnored': True})

else:
    assert control('history', 'undo').get('actionStatus') == 0
    save()
    baseline = json.loads((area / 'keyboard-native-baseline.json').read_text())
    wait_for(lambda: items() == baseline)
    record({'model': model, 'phase': 'undo', 'passed': True, 'restoredRanges': [[row['start'], row['end']] for row in baseline]})
