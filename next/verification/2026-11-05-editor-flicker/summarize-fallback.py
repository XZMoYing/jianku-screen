import json
from pathlib import Path

area = Path('/private/tmp/jianku-editor-flicker-20261105')
metadata = json.loads((area / 'alpha58-capture-result.json').read_text())
started = metadata['capturer']['firstSampleAtUnix']
ended = started + metadata['capturer']['durationRequested']
folder = Path.home() / 'Library/Application Support/com.jianku.screen.next'
rows = []
for path in folder.glob('editor-fallback-diagnostics-editor-*.json'):
    if path.is_symlink():
        continue
    data = json.loads(path.read_text())
    assert data['schema'] == 1 and len(data['records']) <= 64
    for row in data['records']:
        assert row['boundary'] in ['route-suspense', 'project-metadata', 'instance-data', 'export-suspense', 'unspecified']
        if started - 0.2 <= row['at'] / 1000 <= ended + 0.2:
            rows.append({'windowLog': path.name, 'secondsFromFirstVideoSample': row['at'] / 1000 - started, **row})
rows.sort(key=lambda row: row['at'])
report = {'installedCandidate': metadata['version'], 'scope': 'actual opted-in fallback connection events during the owned capture; missing rows do not prove absence of flicker', 'events': rows}
(area / 'alpha58-fallback-summary.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(report, ensure_ascii=False, indent=2))
