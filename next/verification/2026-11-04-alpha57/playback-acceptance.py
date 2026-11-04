import json
import re
import subprocess
import time
from pathlib import Path

area = Path('/private/tmp/jianku-alpha57-20261104')
helper = area / 'editor-ax'
project = area / '3D拖动.jks'
config = json.loads((project / 'project-config.json').read_text())


def state():
    result = subprocess.run([str(helper)], capture_output=True, text=True, check=True, timeout=20)
    value = json.loads(result.stdout)
    assert value.get('ownedEditorWindowCount') == 1
    assert any(node.get('AXRole') == 'AXTextField' and node.get('AXValue') == '拖动与缩放验收（573D拖动）' for node in value['nodes'])
    return value


def press(description):
    value = state()
    matches = [node for node in value['nodes'] if node.get('AXDescription') == description and 'AXPress' in node.get('actions', [])]
    assert len(matches) == 1
    node = matches[0]
    result = subprocess.run([str(helper), 'action', str(node['index']), node['AXRole'], 'AXPress'], capture_output=True, text=True, check=True, timeout=20)
    assert json.loads(result.stdout)['actionStatus'] == 0


def playback():
    value = state()
    play = next(node for node in value['nodes'] if node.get('AXDescription') == '播放/暂停视频')
    times = [node for node in value['nodes'] if node.get('AXRole') == 'AXStaticText' and re.fullmatch(r'\d+:\d{2}\.\d{2}', node.get('AXValue', '')) and abs(node.get('position', {}).get('y', -999) - play['position']['y']) < 15]
    times.sort(key=lambda node: node['position']['x'])
    assert len(times) == 2 and times[1]['AXValue'] == '0:16.00'
    minutes, seconds = times[0]['AXValue'].split(':')
    return {'time': int(minutes) * 60 + float(seconds), 'playing': play['AXValue'] == '1', 'windowID': value['windowID']}


def wait_for_time(minimum):
    deadline = time.monotonic() + 15
    samples = []
    while time.monotonic() < deadline:
        row = playback()
        samples.append(row)
        if row['time'] >= minimum:
            assert row['playing']
            return samples
        time.sleep(0.15)
    raise RuntimeError('Owned preview did not advance')


assert not playback()['playing']
focused = json.loads(subprocess.check_output([str(helper), 'focus-window', '0'], text=True))
assert focused['selectedWindowFocused']
press('回到开头')
press('播放/暂停视频')
first = wait_for_time(4)
press('播放/暂停视频')
paused = playback()
assert not paused['playing'] and 4 <= paused['time'] < 9
capture = area / '3D-native-paused.png'
assert not capture.exists()
subprocess.run(['/usr/sbin/screencapture', '-x', '-o', '-l', str(paused['windowID']), str(capture)], check=True)
press('回到开头')
assert playback()['time'] < 0.1
press('播放/暂停视频')
replay = wait_for_time(1.5)
press('播放/暂停视频')
assert not playback()['playing']
press('回到开头')
assert playback()['time'] < 0.1
assert json.loads((project / 'project-config.json').read_text()) == config
report = {'passed': True, 'firstPlaybackSamples': first, 'replayAfterPauseAndResetSamples': replay, 'projectConfigPreserved': True, 'scope': 'native time advance, pause and restart; not frame-pacing or full flicker acceptance'}
(area / 'playback-results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(report, ensure_ascii=False))
