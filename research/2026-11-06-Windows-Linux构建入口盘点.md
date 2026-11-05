# Windows/Linux 下一步只读盘点（2026-11-06）

## 进度与验收

队列 `.dsh/unattended/queue.md:237`–`:241` 的 U12–U16 均未完成：能力/依赖矩阵、Windows 编译及功能、Linux X11/Wayland 功能、三平台打包和回滚均有独立门槛。正式版计划 `docs/首个正式版发布计划.md:17` 要求分别取得目标平台构建和运行证据，不能据共享代码或条件编译宣称支持。当前队列未记录简库 Windows/Linux 完整目标平台构建与运行通过；本次未查询远端 CI 运行记录，因此不推断历史 CI 结果。

已有基础：Cap 源码包含 Windows/Linux 录制、摄像头、目标发现和平台实现；`tauri.conf.json:50` 已配置三个通用辅助程序、`:85` Windows 安装器、`:97` Linux 包依赖；`.github/workflows/ci.yml:250` 有三系统矩阵，`desktop-release.yml:363` 有目标平台打包逻辑。这些是源码和工作流存在的证据，不等于简库当前配置已完成构建或运行。尤其 release 工作流使用 `tauri.prod.conf.json`，不等于当前本地 `tauri.jianku.conf.json` 的构建路径。

## 建议下一步：拆分简库平台打包清单

在 alpha63 冻结结束后，抽出简库共用配置和 macOS 专属覆盖配置，并让 `scripts/jianku.mjs` 按宿主平台选择实际配置：Windows/Linux 使用共用的三个 Cap 辅助程序和适用资源，macOS 保留原有 iOS/Android 辅助程序、scrcpy server、SDL 和框架；同步核对 `check` 与 `build/release` 使用相同平台清单及基础资源合并结果，保持 macOS 包内容不变。对现阶段尚无实现的移动采集，沿用实际能力边界，避免通过缺失可执行文件阻断整个桌面打包；这一步不声称移动采集已跨平台可用。

这是具体实现而非仅补说明：`tauri.jianku.conf.json:36`、`:54` 无条件要求 scrcpy server 和两个移动辅助程序，而 `scripts/build-android-capture.mjs:98` 在非 macOS 直接返回，`scripts/jianku.mjs:110` 只为 macOS 构建 iOS helper；因此现有 Windows/Linux 入口虽然在 `jianku.mjs:277` 选择 nsis/deb，清单仍要求该入口不生成的文件。`mobile.rs:198`–`:211` 也使用 macOS 的辅助程序与 Resources 布局，不能把移除打包阻塞当作移动采集完成。优先核实配置合并语义及资源保留，避免意外覆盖基础包资源或改变 Mac 成品。

## 三项主要阻塞

1. **当前简库构建清单与平台产物不一致**：上述移动辅助程序和资源阻断非 Mac 打包；Mac 可实现配置拆分，但无法仅凭静态检查证明目标平台打包成功。
2. **目标系统依赖、编译及应用功能待实证**：现有三平台 CI 和生产配置并非简库当前本地配置的成功证据；Windows 的录制、渲染、演示、快捷键、安装；Linux 的 X11/Wayland、权限、光标、音频和打包均需目标系统逐项验证。
3. **移动采集依赖平台专属路径与原生实现**：`mobile.rs:182`–`:211` 查找路径和 helper 指向 macOS 布局；Windows 的 `.exe`、资源布局以及 Linux 依赖和相应采集实现仍需独立适配，不能因桌面基础包可构建而宣称功能可用。

本次只读检查，未修改仓库、运行构建或测试、操作桌面或触发 CI。建议步骤须在冻结结束后实施；Windows/Linux 原生构建、安装和运行验收不能在当前 Mac 上替代完成。
