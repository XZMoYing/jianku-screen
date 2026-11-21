# 简库镜传 Next（`next/` 目录说明）

本目录承载 **简库镜传 Next** 的当前产品源码（`next/cap/`）与分阶段实测证据（`next/verification/`）。

- **当前本机可试用候选**：`0.2.0-alpha.108 / 2026.108.0`（安装于 `/Applications/Jianku Screen Next.app`，冻结提交 `c505d99`，回滚保留 `alpha.107`）。
- **状态总览与下一步**：见 [`docs/开发交接.md`](../docs/开发交接.md) 与 [`docs/U17-可试用候选状态-2026-11-08.md`](../docs/U17-可试用候选状态-2026-11-08.md)。
- **任务唯一真源**：[`.dsh/unattended/queue.md`](../.dsh/unattended/queue.md)。
- **历史阶段流水（alpha.50 / alpha.66 及之前）**：已归档至 [`docs/archive/`](../docs/archive/README.md)。

## 版本与来源

- **旧版备份**：`backup-qt-0.1.6-20261011`（提交 `df7dd69d8b209f1f21a641a1b4d9236476e5c028`）。
- **新版上游**：Cap `cap-v0.6.0`（提交 `6cfdd172cd53b1d6861852288c2192a8ab743687`），原始导入提交 `44e5cf40a1dfa526399835345bdf4ebcf0556f08`。
- **应用标识**：`com.jianku.screen.next`，工程扩展名 `.jks`（兼容读取 `.cap`）；默认录制保存在 `~/Library/Application Support/com.jianku.screen.next/recordings/`。
- **许可与归属**：核心沿用 AGPLv3 及原始例外，详见 [`cap/LICENSE`](cap/LICENSE) 与 [`cap/JIANKU-NOTICE.md`](cap/JIANKU-NOTICE.md)。

## 构建、签名与验证

在 `next/cap/` 目录执行：

```sh
bun run jianku:setup                        # 锁定依赖、原生媒体库与 Android 组件
bun run jianku:frontend                     # 构建桌面端前端资源
bun run jianku:check                        # cargo fmt --check + cargo check -p cap-desktop
bun run jianku:build                        # 构建调试应用（仅用于功能调试，不代表发布性能）
node scripts/jianku.mjs release             # 构建并重签发布候选包
node scripts/jianku.mjs sign                # 对已编译 bundle 补签并严格验证
node scripts/jianku-unattended-check.mjs    # 无人值守局部基线检查
node scripts/jianku-localization-audit.mjs  # 桌面文案本地化扫描
node scripts/jianku.mjs config darwin       # 查看当前平台打包覆盖配置
```

### 环境与签名要点

- macOS 原生构建需要完整 Xcode（`/Applications/Xcode.app` 或通过 `DEVELOPER_DIR` 指定）、Bun 1.4.0、Rust 1.88+（含 `rustfmt`/`clippy`）、Node 20+。
- macOS 安卓移动录制组件额外依赖 `meson`、`ninja`、`pkg-config`、`sdl3` 与运行期本机 `adb`。
- `next/cap/target/native-deps` 与 `next/cap/target/Frameworks` 存放原生媒体依赖，**请勿误删**。
- 打包后会自动重签并严格验证应用；本机可使用 `JiankuDev` 开发证书与独立钥匙串（或通过 `APPLE_SIGNING_IDENTITY=-` 显式 ad-hoc 签名）。开发签名不等于 Developer ID 公证。
- Windows / Linux 打包配置已按平台拆分（见 [`docs/跨平台构建入口.md`](../docs/跨平台构建入口.md) 与 [`docs/审计-U12-跨平台实现矩阵.md`](../docs/审计-U12-跨平台实现矩阵.md)），目前尚未在目标平台完成实际编译与运行验收。
