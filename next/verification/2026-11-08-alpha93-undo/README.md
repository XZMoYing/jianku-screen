# alpha.93 撤销历史修复实机验证与第二版修复

版本 0.2.0-alpha.93／2026.93.0（冻结 f0d4375，含第一版修复：字幕投影仅在 derived 与当前轨道有差异时写入）。实机验证发现第一版修复解决了初始历史污染，但时间线变化引起的字幕投影夹取仍作为独立派生步骤进入撤销栈。

## alpha.93 实机结果

| 用例 | 结果 |
| --- | --- |
| 打开工程 | undo/redo 按钮 enabled=0（初始历史污染已修） |
| 主轨右端裁剪 8.0→7.527 | undo enabled=1，redo enabled=1 |
| 第一次 Cmd+Z | 主轨仍 7.527；captionSegments 末段 end 由 7.527 回 8.0 → 撤销先吃掉“字幕投影夹取”这个派生步骤 |
| Cmd+Shift+Z | 字幕 end 再夹回 7.527，回到裁剪后状态 |
| 第二次 Cmd+Z | 与第一次相同（仍只回退派生步骤） |
| 字幕拖动 4.92–6.51→5.157–6.747 后 Cmd+Z | 一次撤销即回退字幕到 4.92–6.51（母版+投影一步） |

结论：裁剪的第一次撤销仍先回退派生投影夹取；需要让派生投影写入彻底不进入历史。

## 第二版源码修复（053eec5）

- `context.ts` 增加迟绑定 `applyDerivedWrite`：在 `projectHistory` 创建后赋值为 `projectHistory.applyDerived`；字幕投影在“确有语义变化”时也通过 `applyDerived` 写入，派生写入不进入撤销栈（初始及后续时间线变化都不再产生额外步骤）。
- 检查：`tsc --noEmit`、Biome、captions 18 项 + i18n 3 项共 21 项单测通过。
- alpha.94（冻结 f8ab452）构建中，**实际包验证待下一轮**：打开后 undo 禁用；裁剪一次撤销一次即回退、无额外步骤；字幕拖动撤销/重做正常；输入框焦点下快捷键仍被拦截。未验证前不关闭 U22c2b4b1。

## 未覆盖

- alpha.94 实机验证、滑块焦点场景、重做在各类焦点下的稳定性；本轮未使用用户真实工程。

## 证据文件

- `undo-93-summary.json`：alpha.93 实机步骤、第一版结论、第二版修复与待验项。
- `package-source.json`／`package-archive.json`／`package-installed.json`／`rollback-installed.json`／`prepare.log`／`install.log`／`release.log.gz`：alpha.93 构建与安装证据。
- `ui-drive.swift`、`editor-dump.swift`、`ax-all.swift`：工具源码。
