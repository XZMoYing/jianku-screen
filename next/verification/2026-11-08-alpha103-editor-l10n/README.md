# alpha.103 首页英文与编辑器中文面板本地化复验（U07c/U08c）

版本 0.2.0-alpha.103／2026.103.0（冻结 c2dbb86，含 975d039 编辑器 12 组件 95 处标签本地化 + 6d60983 首页模式/捕获来源）。语言经持久化 store 切换（验后 zh-CN）。

## 结果

- **英文首页**：CJK 残留 **0**；模式标签 Video／Screenshots，捕获来源 Window／Area／Camera Only。
- **中文编辑器 3D 面板**（选中 3D 片段）：找到 外观／景深模糊／时间与高级设置／焦点／视角；英文旧标签 leftovers 为空。
- 结论：alpha.103 实包验证首页模式/捕获来源与编辑器 3D 面板标签本地化生效。
- 未覆盖：其余编辑器面板与折叠分组（字幕/按键/文字/图片/导出/颜色校正/渐变）逐项扫描，首页库/设备/演示/截图英文页面，自定义下拉展开逐项；U07c/U08c 保持开放。

## 证据文件

- alpha103-localization-summary.json：英文首页 CJK 计数/labels、中文 3D 面板标签与结论。
- en-home.json / zh-editor-3d.json：英文首页与中文编辑器 AX 快照。
- package-*.json / prepare.log / install.log / release.log.gz：alpha.103 构建安装验签。
