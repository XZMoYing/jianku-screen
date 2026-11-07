# alpha.94 撤销历史修复实际包验证（U22c2b4b/b4b1 关闭）

版本 0.2.0-alpha.94／2026.94.0（冻结 f8ab452，含 053eec5：applyDerivedWrite 迟绑定，字幕派生投影写入不进入撤销历史）。在自有合成工程上实际验证撤销/重做、焦点拦截与保存重开。

## 结果

| 用例 | 结果 |
| --- | --- |
| 打开工程 | undo/redo 按钮均禁用（enabled=0） |
| 主轨右端裁剪 8.0→7.527 后一次 Cmd+Z | **一次撤销即回退到 0–8**（被夹取的字幕末段 end 同步回 8.0），无额外派生步骤 |
| Cmd+Shift+Z | 回到 7.527（字幕夹取同步） |
| 再次 Cmd+Z | 回到 0–8，一步一撤 |
| 字幕第 3 条拖动 → 5.157–6.747 | 一次撤销回 4.92–6.51、一次重做回 5.157–6.747 |
| 工程名称输入框焦点 + Cmd+Z | 配置不变（被 editorShortcutBlocked 拦截，符合设计） |
| 点击时间线焦点 + Cmd+Z | 生效，主轨 7.527→8.0 |
| 保存后关闭重开 | 主轨 0–7.527、字幕含 5.393–6.983 的编辑全部保留；重开后 undo/redo 再次禁用 |

- 结论：初始历史与派生投影不再污染撤销栈；裁剪/字幕编辑一次撤销一次回退、重做正常；输入框焦点拦截符合设计；保存重开后历史为空且编辑保留。

## 未覆盖

- 滑块获得焦点的场景（点击坐标未命中，未做结论）、不同焦点组合下重做的稳定性、真实用户工程；U22c2b4b 其余范围（连续拖动/闪屏）仍由 U22 父项跟踪。

## 证据文件

- `undo-94-summary.json`：各用例配置状态与结论。
- `package-source.json`／`package-archive.json`／`package-installed.json`／`rollback-installed.json`／`prepare.log`／`install.log`／`release.log.gz`：alpha.94 构建与安装证据。
- `ui-drive.swift`、`editor-dump.swift`、`ax-all.swift`：工具源码。
