# alpha.107 许可页面与品牌替换问题（U10 F6 续）

版本 0.2.0-alpha.107／2026.107.0（冻结 98bb31a）。在设置「许可」页新增「开源许可」区块与「查看随包许可文件」按钮。

## 结果

- 许可页实包可见：标题「开源许可」、简库镜传 Next / AGPLv3、说明、按钮「查看随包许可文件」。
- 发现品牌替换 bug：中文界面把许可文案中的 Cap 全局替换成“简库镜传 Next”（utils/i18n.ts 的单词边界 Cap 替换），显示为「本项目基于 简库镜传 Next 0.6.0 修改…」，上游归属错误。
- 修复（源码已完成，待 alpha.108）：新增 tUnbranded（不执行品牌替换、仍走词典与插值），许可页标题/描述改用它，补英文翻译；tsc/Biome/i18n 测试通过。
- 未验证：点击按钮后的 Finder 展开结果；其它含 Cap 的归属/说明文案影响面（品牌替换策略需设计复核）。

## 证据

- license-page-summary.json；license-page.json（许可页 AX 快照）；package-*.json / prepare.log / install.log / release.log。
