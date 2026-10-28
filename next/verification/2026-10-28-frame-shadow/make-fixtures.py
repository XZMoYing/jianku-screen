from pathlib import Path
import copy
import hashlib
import json
import subprocess

work = Path('/private/tmp/jianku-frame-3d')
source = Path('/private/tmp/jianku-preview-fullscreen/sample.jks')
assert (source / '.jianku-preview-resolution-fixture.json').is_file()
original = json.loads((source / 'project-config.json').read_text())
cases = [
    ('browser-light', 'browser', 'light', False, 0, True),
    ('browser-dark', 'browser', 'dark', False, 0, True),
    ('browser-motion', 'browser', 'light', True, 0, True),
    ('stress-motion', 'browser', 'light', True, 100, True),
    ('flat-macos', 'macOS', 'light', False, 0, True),
    ('shadow-off-motion', 'none', 'light', True, 0, False),
]
manifest = []
for name, frame, theme, motion, inset, shadow in cases:
    target = work / 'fixtures' / (name + '.jks')
    assert not target.exists()
    target.parent.mkdir(exist_ok=True)
    subprocess.run(['/bin/cp', '-cR', str(source), str(target)], check=True)
    config = copy.deepcopy(original)
    config['background']['frame']['style'] = frame
    config['background']['frame']['theme'] = theme
    config['background']['inset'] = inset
    if not shadow:
        config['background']['shadow'] = 0
        config['camera']['shadow'] = 0
    if not motion:
        config['timeline']['camera3dSegments'] = []
    else:
        for segment in config['timeline']['camera3dSegments']:
            segment['transitionIn'] = 0.8
            segment['transitionOut'] = 0.8
    (target / 'project-config.json').write_text(json.dumps(config, ensure_ascii=False, indent=2) + '\n')
    meta_path = target / 'recording-meta.json'
    meta = json.loads(meta_path.read_text())
    meta['pretty_name'] = '外框与透视阴影验证 ' + name
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n')
    (target / '.jianku-frame-shadow-fixture.json').write_text('{"synthetic":true,"version":1}\n')
    manifest.append({'name':name, 'path':str(target), 'sha256':hashlib.sha256((target / 'project-config.json').read_bytes()).hexdigest()})
assert json.loads((source / 'project-config.json').read_text()) == original
(work / 'fixtures.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print('created six owned APFS clone fixtures; source unchanged')
