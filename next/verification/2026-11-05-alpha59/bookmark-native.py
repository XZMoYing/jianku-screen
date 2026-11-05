import json
import os
import plistlib
import re
import subprocess
import time
from pathlib import Path

area = Path('/private/tmp/jianku-alpha59-20261105')
helper = area / 'editor-ax'
project = area / 'bookmarks.jks'
app = '/Applications/Jianku Screen Next.app'
lease = None
assert plistlib.loads((Path(app) / 'Contents/Info.plist').read_bytes())['CFBundleShortVersionString'] == '0.2.0-alpha.59'


def control(*args):
    env = os.environ.copy()
    if lease is not None:
        env['JIANKU_TEST_EDITOR_LEASE'] = json.dumps(lease)
    return json.loads(subprocess.check_output([str(helper), *args], text=True, timeout=20, env=env))


def ready():
    state = control()
    assert state.get('ownedEditorWindowCount') == 1
    own_title = any(node.get('AXRole') == 'AXTextField' and node.get('AXValue') == '拖动与缩放验收（59书签）' for node in state['nodes'])
    scoped_modal = lease is not None and state['pid'] == lease['pid'] and state['windowID'] == lease['windowID'] and state['bounds'] == lease['bounds'] and any(node.get('AXRole') == 'AXHeading' and node.get('AXTitle') == '录制书签' for node in state['nodes'])
    assert own_title or scoped_modal
    return state


def wait_for(read, predicate, seconds=15):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = read()
        if predicate(value):
            return value
        time.sleep(0.15)
    raise RuntimeError('Expected owned bookmark state was not observed')


def press(node):
    return control('action', str(node['index']), node['AXRole'], 'AXPress')['actionStatus'] == 0


def matches(state, label):
    return [node for node in state['nodes'] if label in [node.get('AXTitle'), node.get('AXDescription')] and 'AXPress' in node.get('actions', [])]


def player_time():
    state = ready()
    play = next(node for node in state['nodes'] if node.get('AXDescription') == '播放/暂停视频')
    times = [node for node in state['nodes'] if node.get('AXRole') == 'AXStaticText' and re.fullmatch(r'\d+:\d{2}\.\d{2}', node.get('AXValue', '')) and abs(node.get('position', {}).get('y', -999) - play['position']['y']) < 15]
    times.sort(key=lambda node: node['position']['x'])
    assert len(times) == 2 and times[1]['AXValue'] == '0:16.00'
    minutes, seconds = times[0]['AXValue'].split(':')
    whole, frames = seconds.split('.')
    return int(minutes) * 60 + int(whole) + int(frames) / 60


state = control()
book_already_open = state.get('ownedEditorWindowCount') == 1 and any(node.get('AXRole') == 'AXTextField' and node.get('AXValue') == '拖动与缩放验收（59书签）' for node in state.get('nodes', []))
if not book_already_open:
    if state.get('ownedEditorWindowCount'):
        assert any(node.get('AXRole') == 'AXTextField' and node.get('AXValue') == '拖动与缩放验收（573D拖动）' for node in state['nodes'])
        assert control('close-synthetic')['actionStatus'] == 0
        wait_for(control, lambda value: not value.get('ownedEditorWindowCount'))
    subprocess.run(['open', '-a', app, str(project)], check=True)
    state = wait_for(control, lambda value: value.get('ownedEditorWindowCount') == 1 and any(node.get('AXValue') == '拖动与缩放验收（59书签）' for node in value.get('nodes', [])))
for label in ['0:01.5 · 操作重点', '0:09.5 · 操作重点']:
    wait_for(ready, lambda value: len(matches(value, label)) == 1)
started = time.time()
for label, expected in [('0:01.5 · 操作重点', 1.5), ('0:09.5 · 操作重点', 9.5)]:
    state = ready()
    target = matches(state, label)
    assert len(target) == 1 and press(target[0])
    wait_for(player_time, lambda value: abs(value - expected) < 0.1)
state = ready()
buttons = matches(state, '录制书签')
lease = {'pid': state['pid'], 'windowID': state['windowID'], 'bounds': state['bounds'], 'createdAt': time.time(), 'projectTitle': '拖动与缩放验收（59书签）'}
assert len(buttons) == 1 and press(buttons[0])
state = wait_for(ready, lambda value: any(node.get('AXRole') == 'AXTextField' and '书签名称' in [node.get('AXTitle'), node.get('AXDescription')] for node in value['nodes']))
fields = [node for node in state['nodes'] if node.get('AXRole') == 'AXTextField' and '书签名称' in [node.get('AXTitle'), node.get('AXDescription')]]
assert len(fields) == 1
assert control('focus-window', '0')['selectedWindowFocused']
state = ready()
fields = [node for node in state['nodes'] if node.get('AXRole') == 'AXTextField' and '书签名称' in [node.get('AXTitle'), node.get('AXDescription')]]
assert len(fields) == 1
field = fields[0]
assert control('text', str(field['index']), 'AXTextField', '已确认书签')['actionStatus'] == 0
state = ready()
fields = [node for node in state['nodes'] if node.get('AXRole') == 'AXTextField' and '书签名称' in [node.get('AXTitle'), node.get('AXDescription')]]
assert len(fields) == 1
assert control('element-key', str(fields[0]['index']), 'AXTextField', 'return')['targetedKeySent'] == 'return'
wait_for(lambda: json.loads((project / 'recording-bookmarks.json').read_text())[0]['label'], lambda value: value == '已确认书签')
state = wait_for(ready, lambda value: len(matches(value, '完成')) == 1)
assert press(matches(state, '完成')[0])
wait_for(ready, lambda value: len(matches(value, '0:01.5 · 已确认书签')) == 1 and len(matches(value, '0:09.5 · 已确认书签')) == 1)
lease = None
folder = Path.home() / 'Library/Application Support/com.jianku.screen.next'
entries = []
for file in folder.glob('editor-fallback-diagnostics-editor-*.json'):
    for row in json.loads(file.read_text())['records']:
        if row['at'] / 1000 >= started and row['connected']:
            entries.append(row)
report = {'passed': True, 'duplicateSourceMarkerPositions': [1.5, 9.5], 'nativeJumpsVerified': [1.5, 9.5], 'sourceSyncOffsetSeconds': 0.5, 'renamePersistedAndBothMarkersUpdated': True, 'globalFallbackEntriesDuringActions': len(entries), 'startedAtUnix': started, 'scope': 'owned native bookmark load, duplicate mapping, jump and explicit refresh after rename; no physical capture acceptance'}
assert not entries, entries
(area / 'bookmark-native-results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(report, ensure_ascii=False))
