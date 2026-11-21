# 简库镜传 Next（Jianku Screen Next）

macOS 录屏、非线性编辑、离线导出、截图与实时演示工具。录制过程将原始画面、指针轨迹、按键、麦克风与系统声音分轨保存，结束后进入内置编辑器做时间线剪辑、自动/手动焦点缩放、3D 运镜、光标平滑、动态模糊、字幕与外观包装；同一套画面合成能力也用于实时演示输出（副屏或会议软件可选共享窗口）。

> **当前状态**：本机 macOS 可试用候选为 **0.2.0-alpha.108 / 2026.108.0**（冻结提交 `c505d99`，回滚保留 `alpha.107`），**尚未达到正式公开发布门槛**。完整状态、硬门槛与接手指南见 [`docs/开发交接.md`](docs/开发交接.md) 与 [`docs/U17-可试用候选状态-2026-11-08.md`](docs/U17-可试用候选状态-2026-11-08.md)。

## 技术栈与目录结构

当前产品源码位于 `next/cap/`，基于 **Tauri v2 + SolidJS + Rust / wgpu**：

```text
next/cap/                 当前产品源码（桌面端、Rust 渲染/录制/工程 crate、脚本）
  apps/desktop/           SolidJS 前端与 src-tauri 原生层
  crates/                 recording / project / rendering / export / cap-test 等核心 crate
  scripts/                简库构建、安装、本地化与验证脚本
  JIANKU-NOTICE.md        上游来源、修改范围与第三方许可说明
next/verification/        各阶段实测证据目录
docs/                     开发交接、发布门槛、审计快照与产品设计文档（历史文档在 docs/archive/）
research/                 动画曲线、弹簧求解与运动模糊研究资料
.dsh/unattended/          任务队列真源（queue.md）与会话日志
src/ ui/ tests/           旧 Qt 0.1.6 历史代码（已停止迭代，仅作追溯参考）
```

> 旧 Qt 0.1.6 完整快照保留于标签 `backup-qt-0.1.6-20261011` 与分支 `backup/qt-0.1.6-2026-10-11`。

## 开发与验证命令

环境要求：macOS 14+（Apple Silicon）、完整 Xcode、Bun 1.4.0、Rust 1.88+、Node 20+。以下均在 `next/cap/` 目录执行：

```sh
bun run jianku:setup                        # 首次准备依赖与原生媒体库
bun run jianku:frontend                     # 仅构建桌面前端
bun run jianku:check                        # cargo fmt --check + cargo check -p cap-desktop
node scripts/jianku-unattended-check.mjs    # 无人值守局部基线检查（配置/Rust/前端测试与构建）
node scripts/jianku.mjs release             # 构建并签名发布候选包
node scripts/jianku-install.mjs --check     # 预演安装到 /Applications
```

桌面前端单元测试（在 `next/cap/apps/desktop/` 目录）：

```sh
bun run vitest run                                      # 纯逻辑单元测试
bun run vitest run --config vitest.interface.config.ts  # 界面与交互组件测试（jsdom）
```

更多环境细节、签名、安装与阶段包闭环见 [`next/README.md`](next/README.md) 与 [`docs/开发交接.md`](docs/开发交接.md)。

## 权限说明（macOS）

应用在录制或实时演示时需要**屏幕录制**与**辅助功能**权限，麦克风与摄像头按需授权。排查权限时请始终从**访达或 Dock**启动应用——从终端启动会使系统将 TCC 权限记在终端名下。重编译或更换签名后，系统可能要求重新授权。

## 许可与归属

- `next/cap/` 基于 Cap 0.6.0（提交 `6cfdd172…`），遵循其原始 **AGPLv3 及例外授权**；具体范围、修改说明与第三方归属见 [`next/cap/LICENSE`](next/cap/LICENSE) 和 [`next/cap/JIANKU-NOTICE.md`](next/cap/JIANKU-NOTICE.md)。
- 根目录旧 Qt 历史代码未授予公共许可，不覆盖或变更上游开源代码的授权条款。
