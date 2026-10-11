# 简库镜传新版

新版在独立分支 `rewrite/cap-foundation` 开发，源代码位于 `next/cap/`。旧版源码、研究和工程格式保留在仓库原有目录；主工作目录继续停留在旧版。

当前阶段目标：导入并验证可运行的录制、编辑和导出底座。已完成源码接入、界面打包和现有几何/权限测试，原生构建等待完整 Xcode。尚未产生可试用的新应用，也未完成动画替换、实时演示和旧工程迁移。

## 版本与来源

- 旧版备份：`backup-qt-0.1.6-20261011`，提交 `df7dd69d8b209f1f21a641a1b4d9236476e5c028`。
- 新版上游：Cap `cap-v0.6.0`，提交 `6cfdd172cd53b1d6861852288c2192a8ab743687`。
- 原始导入提交：`44e5cf40a1dfa526399835345bdf4ebcf0556f08`；导入目录的 Git tree 与上游一致。
- 开发应用标识：`com.jianku.screen.next`；默认设置、录制目录和日志指向独立位置，不接管 Cap 或旧版的工程文件关联；实际写入路径仍需启动后验证。未适配的 GPUI 交接已禁用。
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

首次启动需要为独立应用重新授予系统权限。界面可以单独构建，但只有原生应用实际运行后才能验收录制和导出。所有实测结果继续记录在统一交接文档与本阶段验证目录。

本阶段验证记录见 [verification/2026-10-11-foundation](verification/2026-10-11-foundation/verification.json)。用户正在安装 Xcode 16.2；完成后继续当前阶段，不将环境等待当作已完成验收。
