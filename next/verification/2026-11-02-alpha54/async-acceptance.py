import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

root = Path(__file__).resolve().parents[3]
area = Path('/private/tmp/jianku-alpha54-20261102')
app = '/Applications/Jianku Screen Next.app'
helper = area / 'editor-ax'
project = area / '异步编辑.jks'
title = '拖动与缩放验收（编辑镜头异步编辑）'


def control(*args):
    result = subprocess.run([str(helper), *args], capture_output=True, text=True, timeout=20)
    assert result.returncode == 0, f'Owned AX request rejected: {args}'
    return json.loads(result.stdout)


def ready(expected):
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        state = control()
        if any(node.get('AXRole') == 'AXTextField' and node.get('AXValue') == expected
               for node in state.get('nodes', [])):
            return state
        time.sleep(0.2)
    raise RuntimeError('Expected the named synthetic editor')


if sys.argv[1] == 'prepare':
    source = root.parent / 'Jianku Screen Next Builds/0.2.0-alpha.53/分段镜头验收.jks'
    assert not project.exists()
    for path in source.rglob('*'):
        if not path.is_file() or 'screenshots' in path.relative_to(source).parts or path.name.startswith('.'):
            continue
        target = project / path.relative_to(source)
        target.parent.mkdir(parents=True, exist_ok=True)
        if path.suffix in {'.mp4', '.wav', '.png', '.jpg'}:
            os.link(path, target)
        else:
            shutil.copy2(path, target)
    path = project / 'project-config.json'
    config = json.loads(path.read_text())
    config['timeline'].update({
        'segments': [{'recordingSegment': 0, 'timescale': 1, 'start': 0, 'end': 8, 'name': None}],
        'transitions': [], 'zoomSegments': [], 'textSegments': []})
    path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + '\n')
    path = project / 'recording-meta.json'
    meta = json.loads(path.read_text())
    meta['pretty_name'] = title
    path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n')
    ready('拖动与缩放验收（编辑镜头转场）')
    assert control('save')['saveKeySent']
    time.sleep(0.4)
    assert control('close-synthetic')['actionStatus'] == 0
    subprocess.run(['open', '-a', app, str(project)], check=True)
    ready(title)
    time.sleep(1)
    state = ready(title)
    subprocess.run(['screencapture', '-x', '-o', '-l', str(state['windowID']),
                    str(area / 'async-before.png')], check=True)
    print('Prepared the synthetic editor; inspect async-before.png before running')
elif sys.argv[1] == 'run':
    ready(title)
    path = project / 'content/cursor-0.json'
    assert path.stat().st_nlink == 1
    original = path.read_bytes()
    events = json.loads(original)
    before = json.loads((project / 'project-config.json').read_text())
    assert before['timeline']['zoomSegments'] == []
    sample = json.dumps(events['moves'][0], separators=(',', ':'))
    count = 500000
    temporary = path.with_suffix('.pending.json')
    with temporary.open('w') as file:
        file.write('{"clicks":' + json.dumps(events['clicks']) + ',"moves":[')
        chunk = ','.join([sample] * 1000)
        for index in range(count // 1000):
            if index:
                file.write(',')
            file.write(chunk)
        file.write(']}')
    os.replace(temporary, path)
    byte_count = path.stat().st_size
    try:
        ready(title)
        action = control('generate-edit', '#d6cab1', title)
        assert action.get('pendingObservedBeforeEdit'), 'No confirmed pending edit window; indeterminate'
        assert action.get('generationStatus') == 0 and action.get('editStatus') == 0
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            state = ready(title)
            stale = any('编辑内容已变化，请重新生成自动缩放。' in node.get('AXValue', '')
                        or 'The project changed. Generate auto zoom again.' in node.get('AXValue', '')
                        for node in state['nodes'])
            if stale:
                break
            time.sleep(0.1)
        else:
            raise RuntimeError('No actual stale-result UI confirmation')
        time.sleep(0.6)
        after = json.loads((project / 'project-config.json').read_text())
        assert after['timeline']['zoomSegments'] == []
        assert before['background']['source'] != after['background']['source']
        time.sleep(0.5)
        stable = json.loads((project / 'project-config.json').read_text())
        assert stable['timeline']['zoomSegments'] == []
        assert stable['background']['source'] == after['background']['source']
        report = {'passed': True, 'version': '0.2.0-alpha.54', 'pendingObservedBeforeEdit': True,
                  'actualStaleResultToast': True, 'zoomTrackRemainedEmpty': True,
                  'backgroundEditPersisted': True, 'beforeSource': before['background']['source'],
                  'afterSource': after['background']['source'], 'syntheticMoves': count,
                  'temporaryEventBytes': byte_count,
                  'scope': 'native pending generation and actual color-button edit; save/native-job phase not distinguished'}
        (area / 'async-result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps(report, ensure_ascii=False))
    finally:
        temporary.write_bytes(original)
        os.replace(temporary, path)
else:
    raise ValueError('Expected prepare or run')
