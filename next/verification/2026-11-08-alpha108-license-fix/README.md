# alpha.108 许可页归属修复实包验证（U10 F6 续）

版本 0.2.0-alpha.108／2026.108.0（冻结 c505d99）。修复 alpha.107 发现的品牌替换污染许可归属问题（新增 tUnbranded）。

## 结果

- 中文许可页：标题「开源许可」、归属 **Cap / AGPLv3**、说明「本项目基于 **Cap 0.6.0** 修改，遵循 AGPLv3；源代码与构建说明见项目仓库。第三方组件许可随应用提供。」
- 「查看随包许可文件」按钮 AXPress 成功，前台转为 **com.apple.finder**（展开随包 licenses 目录）。
- 结论：alpha.108 实包许可归属文案与查看入口通过；品牌替换不再污染许可归属。
- 未覆盖：其它含 Cap 的说明/归属文案影响面、许可文件清单人工核对、官方/法律级 AGPL/GPL 合规审查。

## 证据

- license-fix-summary.json；license-108.json（许可页 AX 快照）；package-*.json / prepare.log / install.log / release.log。
