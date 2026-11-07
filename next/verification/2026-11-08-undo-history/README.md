# 撤销历史污染与快捷键焦点复核（源码修复，alpha.92 基线）

## 现象复核（alpha.92 安装包）

- 打开工程后头部撤销按钮即为可用（undo enabled=1）。第一次撤销使配置哈希由 `a403b9a5…` 变为 `a0a2f0a0…`，但主轨 0–8、字幕 4 条、缩放 0 均未变化。
- 与源工程配置对比：差异只有 `timeline.captionSegments[*]` 的 6 个 start/end 由整齐小数值（1.79／2.09／4.92／6.51／7.37）变为 float32 精度值（1.7899999618… 等）——即撤销只回退了字幕派生投影的浮点抖动，是一次“空撤销”。
- 快捷键焦点矩阵（真实按键 + AX 焦点读取）：
  - 焦点 `AXWebArea`（刚启动或点击时间线）：Cmd+Z 生效，主轨裁剪从 7.527 回退 8.0；
  - 焦点 `AXTextField`（工程名称）：Cmd+Z 不生效——符合 `editorShortcutBlocked` 对输入控件的拦截设计；
  - 点击头部按钮后实测焦点仍为 `AXWebArea`，Cmd+Z 生效；
  - 尝试点击滑块的坐标未命中（焦点仍是 AXWebArea），该场景不做结论。
- 结论：快捷键“有时不生效”主要取决于焦点是否落在输入/滑块等被拦截控件；而“看似空的撤销步骤”来自字幕派生投影写入历史。

## 源码修复（2026-11-08）

- `context.ts` 字幕投影 effect 原先无条件 `setProject("timeline","captionSegments", reconcile(derived))`，每次投影（含初始加载、每次 master/timeline 变化）都会产生被历史追踪的写入（含 float32 抖动）。
- 现改为先比较 derived 与当前 `captionSegments`（id／text／start／end／words 以 1e-6 容差），**仅在实际变化时写入**；派生投影不再污染撤销栈，用户编辑仍正常入历史。
- 验证（源码级）：`tsc --noEmit` 退出 0；Biome 检查通过；`captions.ts` 18 项 + `i18n.test.ts` 3 项共 21 项单测通过。
- **实际包验证待 alpha.93**：打开工程后 undo 初始应为禁用；裁剪一次撤销一次即回退、无空步骤；字幕拖动/裁剪撤销仍正常。未完成前不关闭对应队列项。

## 未覆盖

- AXSlider 焦点场景（本轮坐标未命中）、重做在各类焦点下的稳定性、真实键盘输入法与辅助技术场景；原生包行为待 alpha.93 验证。

## 证据文件

- `undo-history-summary.json`：初始历史差异、焦点矩阵、根因候选、源码修复与待验项。
- `ui-drive.swift`（含 `focused` 焦点读取）、`editor-dump.swift`：本轮工具源码。
