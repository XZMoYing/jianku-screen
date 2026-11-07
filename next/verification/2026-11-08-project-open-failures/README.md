# 工程打开失败路径与 --args 实包验收（alpha.99，U24/U9b2）

安装版 alpha.99。核对不存在路径、损坏/缺失 `project-config.json`、命令行 `--args` 传入工程的打开行为与恢复能力。

## 结果

| 用例 | 结果 |
| --- | --- |
| 不存在路径（`open -a app path`） | LaunchServices 直接报 “file does not exist”，应用未启动（exit 1），无崩溃/残留 |
| 不存在路径（`--args`） | 应用正常启动到首页（仅首页窗口），无错误弹窗/编辑器 |
| `--args` 有效工程 | 上次状态为 red；退出后 `--args gray.jks` 启动，编辑器工程名为**颜色契约-gray** → 命令行参数路径生效 |
| 损坏 project-config.json | 编辑器显示错误页：**无法打开录制文件**、**无法读取工程设置，原设置文件已保留。请从可用的副本恢复设置，再重新加载编辑器。**、错误详情、可打开录制文件夹；损坏文件 SHA-256 保持 `2713d764…cffd5`；关闭错误编辑器后打开有效工程正常（297 AX 节点） |
| 缺少 project-config.json | 静默创建默认配置（3194 B、timeline 0–8、captions 0）并以「缺设置工程」打开编辑器，无提示/无错误页；录制媒体与 recording-meta 未被改写（meta 差异仅本轮 pretty_name） |

- 结论：失败路径稳定（不崩溃、损坏配置保留原文件并报错、可恢复打开有效工程），命令行参数可打开指定工程；缺少配置会被静默重建为默认设置（已有编辑丢失、媒体保留），建议后续考虑提示，不据此判崩溃缺陷。
- 测试后应用已退出；未使用用户真实工程。

## 未覆盖

- Dock 拖放、应用内「打开工程」选择器对 `.cap` 的过滤/打开、失败后的自动恢复/备份策略、权限/磁盘错误与真实用户工程。

## 证据文件

- `open-failure-summary.json`：各用例结果、哈希与结论。
- `corrupt-open-ax.json`、`missing-cfg-ax.json`、`args-gray-dump.json`：错误页与参数打开时的 AX 快照。
- `ui-drive.swift`、`ax-all.swift`、`editor-dump.swift`：工具源码。
