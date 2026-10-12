# 简库镜传新版

新版在独立分支 `rewrite/cap-foundation` 开发，源代码位于 `next/cap/`。旧版源码、研究和工程格式保留在仓库原有目录；主工作目录继续停留在旧版。

当前阶段：底座试用及动画校准。已完成源码接入、原生桌面检查、调试应用打包与签名，以及打包内导出程序的本地素材验证。当前源码版本为 0.2.0-alpha.6，已接入连续的光标倾斜与点击形变弹簧、偏侧缩回的模糊中心与 21 次平移采样校准；普通光标移动移除通用预读，位置缓存保留完整收尾，预览与导出共用计算，保留点击前瞻及原有参数和画面配置。此前修正经典 Mac 箭头尖端、小数采集和旋转热点，补充运行时系统外形识别；本轮增加本地工程打开、显式保存、可携带副本、定位和最近打开，副本携带已知外部素材并使用工程内相对路径；完整动画对照、实时演示和旧工程迁移尚未完成；一次实际显示器录制的权限、停止、保存和自动打开编辑器已通过；截图、音频及完整编辑交互仍需实机验收。

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

`setup` 安装锁定依赖和原生媒体库；`frontend` 单独构建界面；`check` 检查原生代码；`build` 打包调试应用；`bun run tauri:build` 打包发布应用。构建入口为本地开发设置独立服务地址，不启动数据库、云服务或额外开发服务器，不使用上游的更新发布配置。

本机已安装 Bun 1.4.0、Rust 1.88.0、rustfmt 和 clippy，保留原有 Node 和 Qt 环境。macOS 原生构建需要完整 Xcode；本机 macOS 14.7.4 可使用 Xcode 16.2。将其放入 `/Applications/Xcode.app` 后，构建入口会自行选择，不更改系统全局开发目录。非标准目录可通过 `DEVELOPER_DIR` 指定。

macOS 打包完成后会重签并严格验证整个应用，避免调试包残留缺少资源封印的链接器签名。本机复用已有 JiankuDev 开发证书及其独立钥匙串；其他机器可设置 `APPLE_SIGNING_IDENTITY` 和 `JIANKU_SIGNING_KEYCHAIN`，没有证书时使用临时签名。开发签名不等于 Developer ID 公证。

首次启动需为「简库镜传 Next」重新授予屏幕录制和辅助功能权限；麦克风和摄像头按需开启。默认选择本地录制，主界面与模式说明仅提供录制和截图，首次引导缩短为权限与本地功能两步。其他继承的云分享、账户、授权与语言入口仍待整理，不表示自身云服务已接入。

默认录制保存在 `~/Library/Application Support/com.jianku.screen.next/recordings/`；可在设置修改录制路径。调试包只用于功能验收，不能据其性能评估正式发布版。所有实测结果继续记录在统一交接文档与本阶段验证目录。

2026-10-12 已确认 Xcode 16.2 初始化完成，原生构建障碍已解除。系统光标兼容证据见 [系统光标验证](verification/2026-10-12-system-cursor/verification.json)；位置时间与收尾证据见 [光标时间验证](verification/2026-10-12-cursor-timing/verification.json)；模糊阶段证据见 [动态模糊验证](verification/2026-10-12-motion-blur/verification.json)；光标阶段证据见 [姿态验证](verification/2026-10-12-cursor-pose/verification.json)；底座证据见 [原生底座验证](verification/2026-10-12-native-foundation/verification.json)；[前期接入记录](verification/2026-10-11-foundation/verification.json)保留当时的失败与等待状态，用于追溯。

本机试用应用：`../Jianku Screen Next Builds/0.2.0-alpha.6/Jianku Screen Next.app`（相对项目工作目录）；实际启动和帧送达记录见 [工程管理验证](verification/2026-10-12-project-files/verification.json)。试用工程在 `~/Movies/Jianku Screen Next/试用 0.2.0-alpha.6/移动后/可携带工程.cap`，含自建背景、贴图、音频与缩放；为验证便携性，测试源工程和外部测试素材已移除，副本和三份对照视频保留。软件内可用主界面“打开工程”或编辑器“工程”菜单选择本地 `.cap` 文件夹/文件包；保存副本时选择新名称，不覆盖已有工程。系统光标仍保持用户当前约 1.4 倍设置，真实录制偏移仍待试录确认。旧应用和用户原工程保留；调试包性能不代表发布版表现。
