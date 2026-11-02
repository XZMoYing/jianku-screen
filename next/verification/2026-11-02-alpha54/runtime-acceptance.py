import json
import plistlib
import subprocess
import sys
import time
from pathlib import Path

app = Path('/Applications/Jianku Screen Next.app')
area = Path('/private/tmp/jianku-alpha54-20261102')
helper = area / 'editor-ax'
matrix = json.loads(Path('/private/tmp/jianku-autozoom-edited-native/matrix.json').read_text())
titles = {
    json.loads((Path(case['path']) / 'recording-meta.json').read_text())['pretty_name']
    for case in matrix
}
report_path = area / 'runtime-results.json'
report = json.loads(report_path.read_text()) if report_path.exists() else []


def check_version():
    info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
    assert info['CFBundleIdentifier'] == 'com.jianku.screen.next'
    assert info['CFBundleShortVersionString'] == '0.2.0-alpha.54'
    assert info['CFBundleVersion'] == '2026.54.0'


def control(*args):
    check_version()
    result = subprocess.run([str(helper), *args], capture_output=True, text=True, timeout=15)
    assert result.returncode == 0, f'Owned AX request rejected: {args}'
    return json.loads(result.stdout)


def fixture_title(state):
    return next((node.get('AXValue') for node in state.get('nodes', [])
                 if node.get('AXRole') == 'AXTextField' and node.get('AXValue') in titles), None)


def ready(title=None):
    deadline = time.monotonic() + 25
    raised = False
    while time.monotonic() < deadline:
        state = control()
        if state.get('ownedEditorWindowCount') == 1:
            found = fixture_title(state)
            if found and (title is None or title == found):
                assert state['path'] == str(app)
                return state
            if not raised:
                subprocess.run(['/private/tmp/jianku-alpha48/owned-ui', 'raise', '视频编辑'],
                               check=True, capture_output=True, text=True)
                raised = True
        time.sleep(0.2)
    raise RuntimeError('The expected owned synthetic editor did not become ready')


def close_owned():
    state = control()
    if not state.get('ownedEditorWindowCount'):
        return
    ready()
    assert control('save')['saveKeySent']
    time.sleep(0.4)
    assert control('close-synthetic')['actionStatus'] == 0
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        if not control().get('ownedEditorWindowCount'):
            return
        time.sleep(0.2)
    raise RuntimeError('The synthetic editor did not close normally')


def record(case, phase, **details):
    row = {'case': case, 'phase': phase, **details}
    report.append(row)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(row, ensure_ascii=False), flush=True)


def config(project):
    return json.loads((project / 'project-config.json').read_text())


def ranges(project):
    return [[round(segment['start'], 6), round(segment['end'], 6)]
            for segment in config(project)['timeline']['zoomSegments']]


def wait_ranges(project, expected):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if ranges(project) == expected:
            return
        time.sleep(0.1)
    raise RuntimeError(f'Expected zoom ranges {expected}; received {ranges(project)}')


def run(case, resume_history=False):
    project = Path(case['path'])
    title = json.loads((project / 'recording-meta.json').read_text())['pretty_name']
    expected = case['expectedZoomRanges']
    if resume_history:
        ready(title)
        assert expected and ranges(project) == expected
    else:
        assert ranges(project) == [], 'Use a clean, closed synthetic fixture'
        close_owned()
        subprocess.run(['open', '-a', str(app), str(project)], check=True)
        state = ready(title)
        buttons = [node for node in state['nodes'] if node.get('AXRole') == 'AXButton'
                   and node.get('AXTitle') in ['· 生成', '· Generate']]
        assert len(buttons) == 1
        assert control('press-title', buttons[0]['AXTitle'])['actionStatus'] == 0
        if expected:
            wait_ranges(project, expected)
            assert all(segment['mode'] == 'auto'
                       for segment in config(project)['timeline']['zoomSegments'])
        else:
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                state = ready(title)
                if any('未检测到可缩放的点击操作' in node.get('AXValue', '')
                       or 'No clicks were found' in node.get('AXValue', '')
                       for node in state['nodes']):
                    break
                time.sleep(0.1)
            else:
                raise RuntimeError('The no-clicks result was not confirmed in the actual UI')
            assert ranges(project) == []
        record(case['case'], 'generated', passed=True, expected=expected, actual=ranges(project))
    if expected:
        ready(title)
        assert control('history', 'undo')['actionStatus'] == 0
        wait_ranges(project, [])
        assert control('history', 'redo')['actionStatus'] == 0
        wait_ranges(project, expected)
        record(case['case'], 'undo-redo', passed=True)
    before = config(project)['timeline']['zoomSegments']
    close_owned()
    subprocess.run(['open', '-a', str(app), str(project)], check=True)
    ready(title)
    assert config(project)['timeline']['zoomSegments'] == before
    record(case['case'], 'save-reopen', passed=True, actual=ranges(project))


name = sys.argv[1]
selected = [case for case in matrix if case['case'] == name]
assert len(selected) == 1
try:
    run(selected[0], len(sys.argv) > 2 and sys.argv[2] == "resume-history")
except Exception as error:
    record(name, 'interrupted', passed=False, error=str(error))
    raise
