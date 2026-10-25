# 简库镜传新版

新版在 `rewrite/cap-foundation` 分支开发，源代码位于 `next/cap/`，当前工作目录为 `Jianku Screen Next`。旧版目录仍保留共用的 Git 仓库及历史源码；旧版应用与构建已经清理。

当前阶段为 `0.2.0-alpha.28`：安卓正常停止时保留静止尾段，动态壁纸精确读取复用关键帧索引；窗口录制保留可选过滤与默认遮挡入镜。此前书签、演示幕布及其他实现的状态与剩余范围见 [当前阶段计划](../docs/当前阶段计划.md)、[待验证项目交接](../docs/待验证项目交接.md) 和 [本轮验证](verification/2026-10-25-android-tail-wallpaper-cache/README.md)。以下早期接入记录用于追溯，不代表当前完整验收状态。

## 版本与来源

- 旧版备份：`backup-qt-0.1.6-20261011`，提交 `df7dd69d8b209f1f21a641a1b4d9236476e5c028`。
- 新版上游：Cap `cap-v0.6.0`，提交 `6cfdd172cd53b1d6861852288c2192a8ab743687`。
- 原始导入提交：`44e5cf40a1dfa526399835345bdf4ebcf0556f08`；导入目录的 Git tree 与上游一致。
- 开发应用标识：`com.jianku.screen.next`；默认设置、录制目录和日志指向独立位置；实际启动已观察到新版数据及日志目录，不接管 Cap 或旧版的工程文件关联。未适配的 GPUI 交接已禁用。
- 上游核心采用 AGPLv3，例外与第三方授权见 [原始许可证](cap/LICENSE)。发布新版时提供对应源码和许可声明。

功能范围和验收顺序见 [新版重构路线](../docs/新版重构路线.md)。未完成事项统一记录在 [待验证项目交接](../docs/待验证项目交接.md)，避免出现多份验收清单。

## 开发与构建

在 `next/cap` 目录执行：

```sh
bun run jianku:setup
bun run jianku:frontend
bun run jianku:check
bun run jianku:build
```

`setup` 安装锁定依赖和原生媒体库；`frontend` 单独构建界面；`check` 检查原生代码；`build` 打包调试应用；`bun run tauri:build` 打包发布应用。已完成编译的调试包可用 `node scripts/jianku.mjs sign` 单独补签并严格验证。构建入口为本地开发设置独立服务地址，不启动数据库、云服务或额外开发服务器，不使用上游的更新发布配置。

macOS 的安卓组件构建还需要 `meson`、`ninja`、`pkg-config` 与 `sdl3`。构建脚本下载并核验固定 scrcpy 4.1 客户端源码与匹配服务端，保存源码补丁，复用已有 FFmpeg 并将运行库装入应用。使用者仍需本机 `adb`，不再依赖另外安装的 scrcpy；原有系统 scrcpy 不被修改。

本机已安装 Bun 1.4.0、Rust 1.88.0、rustfmt 和 clippy，保留原有 Node 和 Qt 环境。macOS 原生构建需要完整 Xcode；本机 macOS 14.7.4 可使用 Xcode 16.2。将其放入 `/Applications/Xcode.app` 后，构建入口会自行选择，不更改系统全局开发目录。非标准目录可通过 `DEVELOPER_DIR` 指定。

macOS 打包完成后会重签并严格验证整个应用，避免调试包残留缺少资源封印的链接器签名。本机复用已有 JiankuDev 开发证书及其独立钥匙串；其他机器可设置 `APPLE_SIGNING_IDENTITY` 和 `JIANKU_SIGNING_KEYCHAIN`，没有证书时使用临时签名。开发签名不等于 Developer ID 公证。

首次启动需为「简库镜传 Next」重新授予屏幕录制和辅助功能权限；麦克风和摄像头按需开启。默认选择本地录制，主界面与模式说明仅提供录制和截图，首次引导缩短为权限与本地功能两步。其他继承的云分享、账户、授权与语言入口仍待整理，不表示自身云服务已接入。

默认录制保存在 `~/Library/Application Support/com.jianku.screen.next/recordings/`；可在设置修改录制路径。调试包只用于功能验收，不能据其性能评估正式发布版。所有实测结果继续记录在统一交接文档与本阶段验证目录。

2026-10-12 已确认 Xcode 16.2 初始化完成，原生构建障碍已解除。系统光标兼容证据见 [系统光标验证](verification/2026-10-12-system-cursor/verification.json)；位置时间与收尾证据见 [光标时间验证](verification/2026-10-12-cursor-timing/verification.json)；模糊阶段证据见 [动态模糊验证](verification/2026-10-12-motion-blur/verification.json)；光标阶段证据见 [姿态验证](verification/2026-10-12-cursor-pose/verification.json)；底座证据见 [原生底座验证](verification/2026-10-12-native-foundation/verification.json)；[前期接入记录](verification/2026-10-11-foundation/verification.json)保留当时的失败与等待状态，用于追溯。

2026-10-13 历史试用记录（该旧包已清理，当前应用统一安装在 `/Applications/Jianku Screen Next.app`）：`0.2.0-alpha.8`（相对项目工作目录）；当前实时演示的启动、显示及重启记录见 [实时演示验证](verification/2026-10-13-live-presentation/verification.json)；前一阶段工程管理记录见 [工程管理验证](verification/2026-10-12-project-files/verification.json)。试用工程在 `~/Movies/Jianku Screen Next/试用 0.2.0-alpha.6/移动后/可携带工程.cap`，含自建背景、贴图、音频与缩放；为验证便携性，测试源工程和外部测试素材已移除，副本和三份对照视频保留。软件内可用主界面“打开工程”或编辑器“工程”菜单选择本地 `.cap` 文件夹/文件包；保存副本时选择新名称，不覆盖已有工程。系统光标仍保持用户当前约 1.4 倍设置，真实录制偏移仍待试录确认。旧应用和用户原工程保留；调试包性能不代表发布版表现。

2026-10-13 接入实时演示首版。主界面“实时演示”打开控制页，开始后出现“简库演示输出”共享窗口；焦点可选自动、手动或关闭，快捷键默认 ⌘/Ctrl+Shift+空格，外观可实时调整。选择副屏时不覆盖主屏或来源屏；物理多屏和会议共享仍需实机验收。实时来源目前限 macOS 显示器，Windows 适配及完整参考效果对照保留待办。验证见 [实时演示证据](verification/2026-10-13-live-presentation/verification.json)。

2026-10-13 主界面整理为录屏/演示双模式工作台。演示控制直接嵌入主窗口，按来源与输出、焦点、画面外观分组；固定操作栏与独立滚动区支持较小窗口。工程和素材库保留在共同工具栏，录制设置及提词器归入更多工具。主窗口可调整大小，切换模式保留设置，运行中的录制/演示不允许误切换到另一模式。证据见 [双模式工作台验证](verification/2026-10-13-dual-mode-workspace/verification.json)。
