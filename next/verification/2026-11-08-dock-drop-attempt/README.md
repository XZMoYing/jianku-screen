# Dock 拖放尝试未验证（alpha.104，U24）

目标：验证把 Finder 中的 .jks 工程拖到**运行中应用**的 Dock 图标能否打开工程。

## 尝试

- 应用运行于首页（无编辑器），Finder 打开 /private/tmp/jianku-alpha104-20261108。
- 通过 AX 坐标定位：Dock 项「Jianku Screen Next」position (1449.97,980.96) size (53.04,64.04)（中心约 1476.5,1013）；Finder 文件「复验（87诊断）.jks」文本 (1179,272)。
- 用 CGEvent drag-screen 从 Finder 文件行拖到 Dock 图标，3 次尝试（起点 1140/1200/1152, 终点 Dock 图标, steps 25–30，最后一次加 700ms dwell）均**未打开工程**（仍仅首页窗口）。

## 结论

自动化拖拽未能触发 Dock 打开工程。可能原因：自动化起点/拖拽事件不被 Finder 识别为文件拖动、Dock spring-loading 参数、或产品未处理该入口。**未做人工确认，不能据此判定产品失败**；Dock 拖放仍未验证，U24 保持开放。

## 未覆盖

- 人工 Dock 拖放确认；冷启动（应用未运行）Dock 拖放；Finder 其它视图/其它文件类型。

## 证据文件

- dock-drop-summary.json：坐标、3 次尝试与结论。
- dock-ax.json / finder-ax.json：Dock 与 Finder 的 AX 树快照。
- ax-app.swift / ui-drive.swift：本次新增 ax-app 与 drag-screen 工具源码。
