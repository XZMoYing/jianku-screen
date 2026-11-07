# 项目便携副本（保存可携带副本）实际包验收（alpha.91）

安装版 0.2.0-alpha.91／2026.91.0。在自有合成工程上通过编辑器工程菜单的「保存可携带副本…」（Cmd+Shift+S）导出便携副本，核对自包含素材、无绝对路径、时间线与源工程一致、源工程未被修改，并实际打开副本。

## 操作路径

1. 打开工程（含 4 条字幕且第 3 条已改为 5.157–6.747）。
2. 聚焦时间线后按 Cmd+Shift+S → 原生保存面板，标题「保存可携带工程副本（请选择新名称）」，预填「字幕导出验收 副本.jks」、位置 tmp。
3. 通过 AX 把文件名设为 `便携副本验收.jks` 并 AXPress Save；应用随即在另一个编辑器打开副本。

## 结果

- **自包含**：`/private/tmp/便携副本验收.jks` 含 `project-config.json`、`recording-meta.json`、`content/display.mp4`、`content/speech.wav`、`assets/current-desktop-background-*.jpg`（5 份）、`screenshots/preview.jpg` 与 `screenshots/preview-config.json`。
- **无绝对路径**：副本的 project-config／recording-meta／screenshots/preview-config 中未发现绝对路径；媒体引用为 `content/display.mp4`、`content/speech.wav` 等相对路径。
- **内容一致**：源与副本的时间线主片段均为 0–8 秒；字幕均为 0–1.79／2.09–4.92／5.157–6.747／7.37–8.0（编辑后的计时被保留）。
- **素材一致**：源与副本的 `display.mp4`、`speech.wav` SHA-256 分别相同。
- **源工程未变**：复制前后源 `project-config.json` 完全一致。
- **可打开**：副本在应用中打开为名「便携副本验收」的编辑器窗口，源工程窗口同时保留「字幕导出验收」；两个窗口均正常显示工程名。
- 保存面板标题、默认名与筛选类型（.jks）符合本地化文案；AX 可读取保存面板字段与按钮。

## 未覆盖

- 含外置导入音频／图片／外置字幕文件的便携副本路径重写（portable 的 imageSegments／audioSegments／字幕路径分支）；覆盖已存在目标、只读/网络目标、磁盘不足、取消与失败提示；便携副本在另一台机器或移动后的实际打开（仅在本机 /private/tmp 验证）；旧外置字幕兼容仍属 U25b。
- 未使用用户真实工程；源工程与测试素材均为自有合成内容。

## 证据文件

- `pc-summary.json`：时间线/字幕对比、文件清单、素材哈希、打开窗口工程名、源配置未变等汇总。
- `copy-project-config.json`：副本工程配置。
- `pc-dialog.json`：保存面板 AX 快照。
- `pc-media-sha.txt`、`pc-tree.txt`：素材哈希与副本文件树。
- `ui-drive.swift`（含 `save-copy` 快捷键）、`ax-all.swift`：本轮自动化工具源码。
