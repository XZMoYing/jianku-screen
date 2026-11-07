# 中文化与本土化批次修复（源码，alpha.91 基线）

在 alpha.91 源码基线上执行汉化审计（`node scripts/jianku-localization-audit.mjs`），修复一批明确的未本地化文案：既包含「英文硬编码出现在中文界面」的集成/状态/提示，也包含「中文硬编码出现在英文界面」的外观/权限/项目打开等文案。

## 修复内容（15 个文件，36 处 localize 调用或词典条目）

- 英文硬编码 → 中文界面：
  - Google Drive 集成：Active for new uploads／Connected but not active／Not connected／Refreshing...／Refresh；
  - S3 集成：Removing...／Remove Config／Testing...／Test Connection；
  - 集成总览：Managed by your organization／Configure；
  - 反馈页：Supported／Not Supported；
  - 更新日志：Failed to fetch changelog；
  - 转写提示数量：item／items；
  - 字幕生成失败提示：No captions were generated...（两处统一）。
- 中文硬编码 → 英文界面：
  - 捕获外观：画面设置未保存，请重试／正在载入画面设置…／保存失败／正在保存…／新捕获使用此设置；
  - 首页系统声音：系统声音／已开启／已关闭；
  - 首页打开工程：正在打开…／打开工程；
  - 权限引导：已开启／开启／整句未授权提示；
  - 编辑器快捷键：标题与说明；
  - 编辑器关闭提示：工程正在保存，请稍后再关闭窗口。
- 词典：zh-CN 增加 14 条、en 增加 12 条（已有条目跳过，不覆盖既有译文）。

## 验证

- `vitest run src/utils/i18n.test.ts`：3 项通过。
- `tsc --noEmit`：退出 0。
- Biome 检查 15 个改动文件：通过（自动格式化 4 个）。
- 审计复跑：候选 2432→2431、可执行 callsite-review 99→64、词典 zh 1679→1693／en 1733→1745、占位符不一致保持 0。
- 剩余 64 条 actionable 候选多为技术格式（FPS/ms/SRT/.jks/路径示例）、模板占位符（{date}/{mode}）、品牌名（Pro/Google Drive/iPhone）与快捷键字符串，按审计约定需逐条语义复核，不批量改。

## 未覆盖

- **运行包实际页面的中英切换与视觉核对未做**：本批只完成源码与测试级验证，需要下一阶段包（计划 alpha.92）在实际界面逐面核对；U07/U08 父项不关闭。
- 原生菜单/对话框/错误、动态字符串与路由可达性不在本审计范围。

## 证据文件

- `localization-batch-summary.json`：审计前后计数、本批修复清单、词典增量与验证结果。
