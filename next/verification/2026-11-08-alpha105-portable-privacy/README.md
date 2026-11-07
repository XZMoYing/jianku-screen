# alpha.105 便携副本外置素材隐私确认（U09b3）

版本 0.2.0-alpha.105／2026.105.0（冻结 54ebb59）。修复 U09 F1/F2：便携副本保存前扫描工程引用的外部素材并确认。

## 实现

- 新增 project-copy-assets.ts：扫描 background、imageSegments、audioSegments、styleSegments.overrides.background 的路径，识别绝对路径/盘符/.. 穿越。
- ProjectMenu：有外部素材时 ask 警告列出前 6 个文件；取消则中止，确认后进入原生保存面板。无外部素材不弹窗。
- 3 项单测通过，tsc/Biome 通过。

## 实包验证（alpha.105）

| 路径 | 结果 |
| --- | --- |
| 取消 | 外置素材夹具 Cmd+Shift+S → 警告「包含外部素材」（列出 external-asset.png）→ 按 No → **无副本生成** |
| 确认 | 再次 Cmd+Shift+S → Yes → 原生保存面板 → 保存「警告确认副本.jks」→ 副本含 assets/portable/<uuid>/external-asset.png，配置 path 为相对路径、资产存在 |
| 无外置素材 | 内建素材夹具 → 无警告、直接保存面板 |

## 残余

- 警告对话框按钮显示英文 No/Yes（中文界面下）；已源码传 okLabel/cancelLabel（继续保存/取消）+ 词典，待 alpha.106 实包复验。
- U09 不关闭：Windows/Linux 路径语义、符号链接/异常路径攻击面、Python 等其它外部路径待验。

## 证据

- portable-privacy-summary.json；warn-dialog.json / warn-dialog2.json / internal-warn.json / after-save.json（对话框与保存面板 AX 快照）；package-*.json / prepare.log / install.log / release.log。
