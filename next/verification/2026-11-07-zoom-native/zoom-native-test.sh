#!/bin/zsh
# 需要：alpha.89 已安装、应用已启动且打开了合成工程 复验（87诊断）.jks
set -e
T=/private/tmp/jianku-alpha89-20261107
P="$T/复验（87诊断）.jks"
cd "$T"
WID=$("$T/ui-drive" windows | python3 -c 'import json,sys;d=json.load(sys.stdin);print([w["id"] for w in d["windows"] if "视频编辑" in w["title"]][0])')
echo "editor window: $WID"
cp "$P/project-config.json" "$T/config-before.json"
summarize() { python3 - "$1" <<'PY'
import json,sys
from pathlib import Path
T=Path('/private/tmp/jianku-alpha89-20261107')
c=json.loads((T/'复验（87诊断）.jks/project-config.json').read_text())
z=(c.get('timeline') or {}).get('zoomSegments') or []
print(json.dumps({'step':sys.argv[1],'count':len(z),'segments':[{'start':round(s['start'],3),'end':round(s['end'],3)} for s in z]},ensure_ascii=False))
PY
}
"$T/ui-drive" drag "$WID" 400 848 800 848 12 >/dev/null; sleep 1.5
"$T/ui-drive" key save >/dev/null; sleep 1.2
summarize create
"$T/ui-drive" key undo >/dev/null; sleep 1; "$T/ui-drive" key save >/dev/null; sleep 1.2
summarize undo
"$T/ui-drive" key redo >/dev/null; sleep 1; "$T/ui-drive" key save >/dev/null; sleep 1.2
summarize redo
"$T/ui-drive" drag "$WID" 600 848 700 848 10 >/dev/null; sleep 1
"$T/ui-drive" key save >/dev/null; sleep 1.2
summarize move
"$T/ui-drive" drag "$WID" 898 848 950 848 10 >/dev/null; sleep 1
"$T/ui-drive" key save >/dev/null; sleep 1.2
summarize trim
"$T/ui-drive" key undo >/dev/null; sleep 1; "$T/ui-drive" key save >/dev/null; sleep 1.2
summarize undo-trim
"$T/ui-drive" drag-cancel "$WID" 1100 848 1250 848 >/dev/null; sleep 1
"$T/ui-drive" key save >/dev/null; sleep 1.2
summarize after-cancel
"$T/ui-drive" key undo >/dev/null; sleep 1; "$T/ui-drive" key save >/dev/null; sleep 1.2
summarize after-undo-cancel
"$T/ui-drive" right-click "$WID" 800 848 >/dev/null; sleep 0.8
"$T/editor-dump" > "$T/editor-dump-menu.json"
"$T/ui-drive" key escape >/dev/null
echo "done"
