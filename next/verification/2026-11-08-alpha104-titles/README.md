# alpha.104 片段标题模板本地化实际包复验（U07c）

版本 0.2.0-alpha.104／2026.104.0（冻结 3e66b22，含 cd10ce1 7 处片段标题模板 localize）。中文界面验证（验后 zh-CN）。

## 结果

- 选中字幕片段：侧栏标题 **字幕 1**（此前 Caption 1）。
- 选中文字片段（文字遮罩验收夹具）：**文本 1**，样式区 **样式**。
- 选中遮罩片段：**遮罩 1**。
- 英文回退未重新捕获：英语界面选中字幕段的点击未命中片段，未取到 Caption 1；源码 localize 在英文下回退原文，理论上仍为 Caption 1，**不记为英文已验证**。

## 结论

alpha.104 实包验证中文片段标题模板（字幕/文本/样式/遮罩）本地化生效；按键/缩放/片段/编辑样式标题与英文回退未在实包捕获，U07c 仍开放。

## 证据文件

- alpha104-titles-summary.json：中文标题命中、英文尝试与未覆盖项。
- zh-caption-title.json / zh-text-title.json / zh-mask-title.json / en-caption-title.json：选中片段后的 AX 快照。
- package-*.json / prepare.log / install.log / release.log.gz：alpha.104 构建安装验签。
