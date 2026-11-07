# alpha.101 本地化下拉选项实际包复验（U07/U08）

版本 0.2.0-alpha.101／2026.101.0（冻结 19c6b10，含 ebd6c7d 下拉选项 localize）。语言经持久化 interface_language store 切换（验后恢复 zh-CN）。

## 结果

- 英文设置弹层值：
  - Language English；Recording countdown 3 seconds；Main window when recording starts **Off**；After recording **Open editor**；After deleting a recording **Do nothing**；Max capture framerate 60 FPS (recommended)。
- 中文设置弹层值：界面语言 简体中文；录制倒计时 3 秒；开始录制时的主窗口 关闭；录制完成后 打开编辑器；删除录制后 不执行操作；捕获帧率上限 60 帧/秒（推荐）。
- 英文设置页扫描：遍历 General／Recording quality／Hotkeys／CLI／Recordings／Screenshots／Automations／Transcription／Integrations／Experimental／Changelog，除录制/截图工程名（用户内容，正确保留中文）外**未发现中文 UI 残留**。
- 发现语义问题：英文主窗口选项显示 “Off”（“关闭”被全局译为 Off），不适合窗口关闭行为；已源码改为 localize(“Close window”) 并补 zh 词典（中文=关闭），**未包含在 alpha.101，待 alpha.102 复验**。

## 结论

alpha.101 中三组下拉选项（录制后/删除后/主窗口）已按语言显示，设置页英文扫描干净；“Close window” 语义修正待下一包。U07/U08 父项因编辑器/时间线/导出与首页/库/设备/演示/截图等页面范围仍开放。

## 证据文件

- alpha101-localization-summary.json：中英弹层值、扫描结论、已修问题与待验项。
- en-general.json / zh-general.json / scan-*.json：中英设置页 AX 快照与英文页面扫描。
- package-*.json / prepare.log / install.log / release.log.gz：alpha.101 构建安装验签。
