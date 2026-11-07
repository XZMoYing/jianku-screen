# 窗口缩放与语言切换触发闪屏：本轮未验证（alpha.104）

目标：验证 U22 的另外两个闪屏触发（窗口缩放、编辑器打开时切换界面语言）是否造成整窗骨架/闪屏。两项均因自动化限制未真正触发，**不作为产品结论**。

## 窗口缩放

- 新增 ui-drive resize-window（AXSize/AXPosition 设置）；对编辑器窗口尝试 1200×800、1500×900、1600×900、1440×900 均返回 resized=false（AX 属性设置失败），窗口未实际缩放。
- 取帧 504 帧/10s，luma 恒 213.3、diff 0（窗口未变化），不能作为闪屏结论。

## 语言切换

- 设置-通用-界面语言为自定义 ChooseSelect：点击弹层后用 Down/Return（英文）、Up/Return（中文）键盘操作未改变值；AX 仅见「简体中文」「跟随系统」项，English 项不可见/被遮挡。
- 语言 store 最终仍 zh-CN；编辑器取帧 449 帧/10s，diff 0、luma 213.3 恒定 → 语言实际未切换，不能作为「语言切换无闪屏」结论。

## 未覆盖

窗口缩放触发闪屏、语言切换触发闪屏/重载、自定义 ChoiceSelect 选项点击、bookmarks 等其它触发。

## 证据

- resize-lang-attempt-summary.json；resize.mov/log/analysis、lang.mov/log/analysis、lang-*.json 快照。

## 语言切换第二次尝试（补充）

- 打开自定义 ChoiceSelect 后，AX 仅暴露「简体中文」(y405) 与「跟随系统」(y491) 两个 StaticText，English 行不可见。
- 用 click-screen 点击两者之间的估计 English 行位置 (1120,448)：language store 仍为 zh-CN；再次打开下拉后目标区域 AX 无节点（列表未暴露 English 行或点击落空）。
- 结论：自定义 ChoiceSelect 选项行未被 AX 暴露且坐标点击未生效，语言切换无法通过当前自动化完成；语言切换闪屏仍未验证。
