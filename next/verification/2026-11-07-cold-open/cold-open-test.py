import json, shutil, subprocess, sys, time
from pathlib import Path

T = Path('/private/tmp/jianku-alpha88-20261107')
APP = '/Applications/Jianku Screen Next.app'
FIXTURE = T / '复验（87诊断）.jks'
QUIT = T / 'quit-app'
STATE = T / 'editor-state'
LOG = Path.home() / 'Library/Logs/com.jianku.screen.next/cap-desktop.log.2026-11-07'

def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)

def app_pid():
    out = run(['ps', '-eo', 'pid=,command=']).stdout.splitlines()
    for line in out:
        parts = line.strip().split(None, 1)
        if len(parts) == 2 and parts[1] == APP + '/Contents/MacOS/Jianku Screen Next':
            return int(parts[0])
    return None

def quit_app():
    run([str(QUIT), 'quit'])
    for _ in range(60):
        if app_pid() is None:
            return True
        time.sleep(0.25)
    return False

def state(expected):
    result = run([str(STATE), expected])
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return {'running': False, 'raw': result.stdout[:200], 'stderr': result.stderr[:200]}

def make_project(name):
    target = T / f'{name}.jks'
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(FIXTURE, target)
    meta_path = target / 'recording-meta.json'
    meta = json.loads(meta_path.read_text())
    meta['pretty_name'] = name
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n')
    return target

def log_offsets():
    try:
        return len(LOG.read_bytes())
    except FileNotFoundError:
        return 0

def new_log(offset):
    try:
        data = LOG.read_bytes()[offset:]
    except FileNotFoundError:
        return ''
    return data.decode('utf8', errors='replace')

def wait_editor(expected, timeout=30):
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        last = state(expected)
        if last.get('expectedHits'):
            return last, time.monotonic()
        time.sleep(0.5)
    return last, None

def open_with(args):
    return run(['open'] + args)

cases = []
projects = {name: make_project(name) for name in ['冷启动文件验收', '热打开验收', '多文件甲', '多文件乙']}

# A: cold start, explicit app, single file
assert quit_app(), 'app did not quit before case A'
offset = log_offsets()
pid_before = app_pid()
started = time.monotonic()
opened = open_with(['-a', APP, str(projects['冷启动文件验收'])])
state_a, hit_at = wait_editor('冷启动文件验收')
time.sleep(1.0)
log_a = new_log(offset)
cases.append({
    'case': 'A-cold-open-a-single',
    'pidBefore': pid_before,
    'pidAfter': app_pid(),
    'openExit': opened.returncode,
    'expectedHit': bool(state_a.get('expectedHits')),
    'hitAfterSec': round(hit_at - started, 2) if hit_at else None,
    'editorWindows': state_a.get('editorWindowCount'),
    'windowTitles': [w.get('title') for w in state_a.get('windows', [])],
    'expectedHits': state_a.get('expectedHits'),
    'logKeyframeForRequested': f'{projects["冷启动文件验收"]}//content/display.mp4' in log_a or f'{projects["冷启动文件验收"]}/content/display.mp4' in log_a,
})

# C: hot open while running
offset = log_offsets()
pid_before = app_pid()
started = time.monotonic()
opened = open_with(['-a', APP, str(projects['热打开验收'])])
state_c, hit_at = wait_editor('热打开验收')
time.sleep(1.0)
log_c = new_log(offset)
cases.append({
    'case': 'C-hot-open-a-single',
    'pidBefore': pid_before,
    'pidAfter': app_pid(),
    'openExit': opened.returncode,
    'expectedHit': bool(state_c.get('expectedHits')),
    'hitAfterSec': round(hit_at - started, 2) if hit_at else None,
    'editorWindows': state_c.get('editorWindowCount'),
    'windowTitles': [w.get('title') for w in state_c.get('windows', [])],
    'expectedHits': state_c.get('expectedHits'),
    'logKeyframeForRequested': f'{projects["热打开验收"]}//content/display.mp4' in log_c or f'{projects["热打开验收"]}/content/display.mp4' in log_c,
})

# B: cold start through the default LaunchServices handler (Finder double-click equivalent)
assert quit_app(), 'app did not quit before case B'
offset = log_offsets()
pid_before = app_pid()
started = time.monotonic()
opened = open_with([str(projects['热打开验收'])])
state_b, hit_at = wait_editor('热打开验收')
time.sleep(1.0)
log_b = new_log(offset)
cases.append({
    'case': 'B-cold-default-handler-single',
    'pidBefore': pid_before,
    'pidAfter': app_pid(),
    'openExit': opened.returncode,
    'openStderr': opened.stderr.strip()[:200],
    'expectedHit': bool(state_b.get('expectedHits')),
    'hitAfterSec': round(hit_at - started, 2) if hit_at else None,
    'editorWindows': state_b.get('editorWindowCount'),
    'windowTitles': [w.get('title') for w in state_b.get('windows', [])],
    'expectedHits': state_b.get('expectedHits'),
    'logKeyframeForRequested': f'{projects["热打开验收"]}//content/display.mp4' in log_b or f'{projects["热打开验收"]}/content/display.mp4' in log_b,
})

# D: cold start with two files
assert quit_app(), 'app did not quit before case D'
offset = log_offsets()
pid_before = app_pid()
started = time.monotonic()
opened = open_with(['-a', APP, str(projects['多文件甲']), str(projects['多文件乙'])])
state_d1, hit_d1 = wait_editor('多文件甲', timeout=20)
state_d2, hit_d2 = wait_editor('多文件乙', timeout=10)
time.sleep(1.0)
log_d = new_log(offset)
cases.append({
    'case': 'D-cold-open-a-multiple',
    'pidBefore': pid_before,
    'pidAfter': app_pid(),
    'openExit': opened.returncode,
    'hitOnFirst': bool(state_d1.get('expectedHits')),
    'hitOnSecond': bool(state_d2.get('expectedHits')),
    'firstHitAfterSec': round(hit_d1 - started, 2) if hit_d1 else None,
    'secondHitAfterSec': round(hit_d2 - started, 2) if hit_d2 else None,
    'editorWindows': state_d2.get('editorWindowCount'),
    'windowTitles': [w.get('title') for w in state_d2.get('windows', [])],
    'expectedHitsSecond': state_d2.get('expectedHits'),
    'logHasJia': '多文件甲' in log_d,
    'logHasYi': '多文件乙' in log_d,
})

import plistlib
version = plistlib.loads(Path(APP + '/Contents/Info.plist').read_bytes())['CFBundleShortVersionString']
out = {'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'appVersion': version, 'cases': cases}
(T / 'cold-open-results.json').write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(out, ensure_ascii=False, indent=1))