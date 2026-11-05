import collections
import json
import plistlib
import subprocess
import sys
import time
from pathlib import Path

area = Path('/private/tmp/jianku-editor-flicker-20261105')
old = Path('/private/tmp/jianku-alpha57-20261104')
version = sys.argv[1]
assert version in ['57', '58']
helpers = old if version == '57' else Path('/private/tmp/jianku-alpha58-20261105')
app = Path('/Applications/Jianku Screen Next.app')
assert plistlib.loads((app / 'Contents/Info.plist').read_bytes())['CFBundleShortVersionString'] == '0.2.0-alpha.' + version
project = old / '3D拖动.jks'
helper = helpers / 'editor-ax'


def control(*args):
    result = subprocess.run([str(helper), *args], capture_output=True, text=True, timeout=20, check=True)
    return json.loads(result.stdout)


def ready():
    state = control()
    assert state.get('ownedEditorWindowCount') == 1
    assert any(node.get('AXRole') == 'AXTextField' and node.get('AXValue') == '拖动与缩放验收（573D拖动）' for node in state['nodes'])
    return state


before = json.loads((project / 'project-config.json').read_text())
state = ready()
assert control('focus-window', '0')['selectedWindowFocused']
state = ready()
groups = [node for node in state['nodes'] if node.get('AXRole') == 'AXGroup' and '3D 镜头' in node.get('AXHelp', '') and node.get('size', {}).get('height') == 44]
assert len(groups) == 2
group = min(groups, key=lambda node: node['position']['x'])
bounds = state['bounds']
x = group['position']['x'] + 50 - bounds['X']
y = group['position']['y'] + 22 - bounds['Y']
preview = collections.Counter((node['position']['x'] - bounds['X'], node['position']['y'] - bounds['Y'], node['size']['width'], node['size']['height']) for node in state['nodes'] if node.get('AXRole') == 'AXGroup' and 200 < node.get('size', {}).get('width', 0) < bounds['Width'] * 0.75 and 100 < node.get('size', {}).get('height', 0) < bounds['Height'] * 0.75)
rects = [rect for rect, count in preview.items() if count >= 4]
assert rects, preview
preview_rect = max(rects, key=lambda rect: rect[2] * rect[3])
output = area / f'alpha{version}-move.mov'
assert not output.exists()
with (area / f'alpha{version}-capture.log').open('x') as capture_log:
    capture = subprocess.Popen([str(area / 'record-owned-window-cg'), str(state['windowID']), '7', str(output)], stdout=subprocess.PIPE, stderr=capture_log, text=True)
    line = capture.stdout.readline()
    assert line.startswith('OWNED_WINDOW_CAPTURE_READY'), line
    capture_log.write(line)
    time.sleep(0.5)
    assert ready()['windowID'] == state['windowID']
    started = time.time()
    with (area / f'alpha{version}-drag.log').open('x') as drag_log:
        result = subprocess.run([str(helpers / 'drag-owned'), str(state['windowID']), str(x), str(y), str(x + 81), str(y), '16', '0.9', 'normal', 'raw'], stdout=drag_log, stderr=subprocess.STDOUT, timeout=25)
    ended = time.time()
    capture_log.write(capture.stdout.read())
    assert capture.wait(timeout=20) == 0
assert result.returncode == 0
assert control('save')['saveKeySent']
time.sleep(0.4)
after = json.loads((project / 'project-config.json').read_text())
a = after['timeline']['camera3dSegments'][0]
b = before['timeline']['camera3dSegments'][0]
assert abs(a['start'] - b['start'] - 0.9989033124440465) < 0.02
assert control('history', 'undo')['actionStatus'] == 0
assert control('save')['saveKeySent']
time.sleep(0.4)
restored = json.loads((project / 'project-config.json').read_text())
assert restored == before
row = {'version': '0.2.0-alpha.' + version, 'bounds': bounds, 'previewRectInWindowPoints': preview_rect, 'dragStartedAtUnix': started, 'dragEndedAtUnix': ended, 'rangeChanged': [a['start'], a['end']], 'undoRestoredFullConfig': True, 'recording': str(output), 'visualResult': 'pending frame review'}
(area / f'alpha{version}-capture-result.json').write_text(json.dumps(row, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(row, ensure_ascii=False))
