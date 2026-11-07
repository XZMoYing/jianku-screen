# alpha.100 本地化第二批实际包验收（U07/U08）

版本 0.2.0-alpha.100／2026.100.0（冻结 48159d3）。本包合入设置-通用、反馈时长、Google Drive 状态、编辑器音频标题等第二批本地化（ebd6c7d）。通过持久化 interface_language store 切换语言（验后恢复 zh-CN；自定义下拉未逐项点击）。

## 英文界面（实际包）

- 通用：System notifications 描述、Confirm when no microphone is selected 描述、Enhance audio in new recordings 描述均为英文；Recording countdown 弹层值 “Recording countdown 3 seconds”。
- 反馈：Test duration 弹层值 “Test duration 20 seconds”；页面说明/Supported 等英文正常。
- **发现残留**：After recording 弹层仍“打开编辑器”、After deleting a recording 仍“不执行操作”、Main window when recording starts 选项仍中文（关闭/最小化）——这些选项未在 alpha.100 包中，已在源码补 localize 并加词典（待 alpha.101 复验）。

## 中文界面（实际包）

- 通用：系统通知描述、麦克风确认描述、声音增强描述、录制开始后关闭或最小化主窗口 均为中文。
- 反馈：测试时长弹层 “测试时长 20 秒”、测试的录制链路 “录制与实时模式”。

## 结论

- alpha.100 已验证第二批描述与时长/倒计时选项按语言正确显示；三组“录制后/删除后/主窗口”下拉选项此前遗漏，已源码修复但不在本包，**U07/U08 父项不关闭**，待 alpha.101 实际包复验。
- 语言验证方法限制：未逐项展开自定义下拉；Google Drive 按钮受 Pro/账户门控未显现。

## 证据文件

- localization2-summary.json：中英实际观察文案、残留项与方法。
- settings-en-general.json / settings-en-feedback.json / settings-zh-feedback.json / settings-zh-general.json：中英设置页 AX 快照。
- package-*.json / prepare.log / install.log / release.log.gz：alpha.100 构建安装验签。
- ui-drive.swift / ax-all.swift：工具源码。
