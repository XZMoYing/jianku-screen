# 旧外置字幕兼容实际包验收（alpha.91）

安装版 0.2.0-alpha.91／2026.91.0。模拟早期版本的工程：字幕不在工程配置里，而是以 `captions.json` 保存在「工程名去扩展名」的同级目录。用 alpha.91 打开该工程，核对读取、迁移、界面显示与旧文件只读行为。

## 夹具与旧布局

- 工程：`/private/tmp/旧外置字幕验收2.jks`（来源为自有合成工程，删除 `project-config.json` 的 `captions` 键与 `timeline.captionSegments`，模拟真正旧工程）。
- 旧外置字幕：`/private/tmp/旧外置字幕验收2./captions.json`（去扩展名列同级目录，点后缀变体；690 字节，2 条：0.5–1.5「旧外置字幕一」、3.0–4.0「legacy two」）。
- 对照夹具 `旧外置字幕验收.jks`：保留空的 `captions` 对象，用于观察迁移条件。

## 结果

| 检查 | 结果 |
| --- | --- |
| 旧文件读取 | 应用日志 `load_captions` 成功读取 2 条（690 字节，来自点后缀同级目录） |
| 迁移到工程母版 | `captions.segments` 出现 legacy-1（0.5–1.5「旧外置字幕一」）与 legacy-2（3.0–4.0「legacy two」） |
| 迁移到时间线 | `timeline.captionSegments` 为 0.5–1.5 与 3.0–4.0 两条，文本一致 |
| 界面 | 时间线出现「字幕」轨，AX 可见「旧外置字幕一」「legacy two」两条字幕标签 |
| 旧文件只读 | 打开/迁移后旧 `captions.json` 未变（690 字节，SHA-256 a6171604…） |
| 工程内新存储 | 未在工程目录生成 `captions.json`；迁移结果保存在 `project-config.json`（当前标准） |
| 对照：已有空 captions 对象 | 旧外置文件同样被 `load_captions` 读取（日志成功），但工程已有 `captions` 对象时**不迁移**，母版与轨道保持为空。记录为条件行为，不判缺陷。 |

## 未覆盖

- 其他旧路径变体（无扩展名同级目录、`.j`／`.jk` 后缀片段、URL 尾分隔符）的原生逐一打开（Rust 单元测试已覆盖路径选择）；旧版 `.cap` 工程字幕；迁移后再次打开/保存/导出 SRT 的完整往返；真实工程转场/变速/空隙组合仍属 U25b。未使用用户真实录制。

## 证据文件

- `legacy-captions.json`：旧外置字幕文件副本。
- `legacy-summary.json`：迁移前后母版/轨道、旧文件哈希、界面标签与对照观察。
- `legacy-load-log.txt`：应用日志中的字幕加载记录。
- `ui-drive.swift`、`ax-all.swift`：自动化工具源码。
