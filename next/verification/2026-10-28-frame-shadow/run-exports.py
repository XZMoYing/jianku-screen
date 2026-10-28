from pathlib import Path
import argparse
import hashlib
import json
import subprocess
import time

parser = argparse.ArgumentParser()
parser.add_argument('--cli', type=Path, required=True)
parser.add_argument('--phase', choices=['before', 'after'], required=True)
args = parser.parse_args()
work = Path('/private/tmp/jianku-frame-3d')
cases = json.loads((work / 'fixtures.json').read_text())
report_path = work / (args.phase + '-exports.json')
assert not report_path.exists()
for case in cases:
    project = Path(case['path'])
    assert json.loads((project / '.jianku-frame-shadow-fixture.json').read_text()) == {'synthetic':True, 'version':1}
    assert hashlib.sha256((project / 'project-config.json').read_bytes()).hexdigest() == case['sha256']
    assert not (work / (args.phase + '-' + case['name'] + '.mp4')).exists()
report = {'cli':str(args.cli), 'cliSha256':hashlib.sha256(args.cli.read_bytes()).hexdigest(), 'runs':[]}
for case in cases:
    out = work / (args.phase + '-' + case['name'] + '.mp4')
    start = time.monotonic()
    with out.with_suffix('.log').open('wb') as log:
        result = subprocess.run([str(args.cli), '--json', 'export', case['path'], '--output', str(out), '--format', 'mp4', '--fps', '60', '--resolution', '1280x720', '--quality', 'maximum'], stdout=log, stderr=subprocess.STDOUT)
    report['runs'].append({'case':case['name'], 'exitCode':result.returncode, 'seconds':time.monotonic()-start, 'output':str(out)})
    report_path.write_text(json.dumps(report, indent=2) + '\n')
    print(report['runs'][-1], flush=True)
    if result.returncode:
        raise SystemExit(result.returncode)
