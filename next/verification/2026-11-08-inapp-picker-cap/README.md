# 应用内「打开工程」选择器打开历史 .cap（alpha.99，U24）

安装版 alpha.99。验证应用内「打开工程」原生选择器是否可打开 .cap 后缀的历史工程（此前只验证过显式 open -a 与命令行 --args）。

## 流程与结果

1. 启动应用 → 首页点击「打开工程」，出现原生 NSOpenPanel（标题「打开录制工程」，提示“选择 .jks 工程，也可以打开历史 .cap 工程。”）。
2. 通过 System Events 发送 Cmd+Shift+G「前往文件夹」，粘贴绝对路径 /private/tmp/jianku-alpha99-20261108/点cap选择器验收.cap，Return 导航后再次 Return 确认。
3. 编辑器成功打开：工程名 **点cap选择器验收**，1 个编辑器窗口、313 AX 节点。
- 源码核对：pick_local_project 使用 NSOpenPanel，canChooseDirectories/canChooseFiles=true，无扩展名过滤，panel message 明确支持历史 .cap。
- 自动化使用 System Events 键盘/剪贴板，仅为测试手段，不改变产品行为。

## 结论

应用内选择器可直接打开历史 .cap 工程（实际点击流程与源码一致）。U24 尚未覆盖：Dock 拖放、Finder「打开方式」菜单（等价默认处理器，已测 .cap 未注册）、真实用户工程/权限错误。

## 证据文件

- inapp-picker-cap-summary.json：流程、工程名、源码核对与未覆盖项。
- picker-opened2.json：打开后的编辑器 AX 快照。
