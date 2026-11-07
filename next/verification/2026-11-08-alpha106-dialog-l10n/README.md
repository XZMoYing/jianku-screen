# alpha.106 便携副本确认对话框按钮本地化（U09b3 续）

版本 0.2.0-alpha.106／2026.106.0（冻结 5efd979）。alpha.105 实包曾发现警告对话框按钮为英文 No/Yes；本轮传入 okLabel/cancelLabel 并验证。

## 结果

- 中文界面：外置素材夹具 Cmd+Shift+S → 标题「包含外部素材」、按钮 **取消 / 继续保存**；按取消后**无副本生成**。
- 英文界面：标题 Includes external assets、按钮 **Cancel / Continue**，消息英文。
- 三路径（取消/确认/无外置素材）在 alpha.105 已通过；本轮补按钮本地化。
- 残余：英文文案 “1 files” 单复数；Windows/Linux 路径语义、符号链接/异常路径攻击面、recording-meta segments/cursors 外部路径入口未覆盖。U09 不关闭。

## 证据

- dialog-l10n-summary.json；zh-dialog.json / en-dialog.json（中英对话框 AX 快照）；package-*.json / prepare.log / install.log / release.log。
