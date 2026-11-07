# alpha.102 Close window 语义与实际包复验（U07c）

版本 0.2.0-alpha.102／2026.102.0（冻结 5d57d0e）。验证 alpha.101 发现的英文主窗口选项 “Off” 语义修正，并补充首页英文扫描。

## 结果

- 英文：Main window when recording starts **Close window**（alpha.101 为 Off）。
- 中文：开始录制时的主窗口 **关闭**；其余弹层：录制倒计时 3 秒、录制完成后 打开编辑器、删除录制后 不执行操作、捕获帧率上限 60 帧/秒（推荐）。
- 英文首页扫描发现中文残留：模式标签「视频／截图」、捕获来源「窗口／区域」。已在源码把 Mode.tsx 的 label/description、new-main 的 name="窗口"/"区域" 改走 localize，并补 en 词典（Mode 两条描述、录制模式、ModeInfoPanel 说明），**未包含在 alpha.102，待 alpha.103 复验**。

## 结论

Close window 语义修正已随 alpha.102 实包生效；首页模式与捕获来源标签的本地化修复待下一包。U07c 尚未关闭。

## 证据文件

- alpha102-close-window-summary.json：中英弹层值与首页扫描结论。
- en-home.json / en-settings.json / zh-settings.json：英文首页、中英设置 AX 快照。
- package-*.json / prepare.log / install.log / release.log.gz：alpha.102 构建安装验签。
