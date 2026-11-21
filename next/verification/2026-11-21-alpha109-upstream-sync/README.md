# 2026-11-21：`0.2.0-alpha.109`（`2026.109.0`）上游同步打包与合成验证

- **版本**：`0.2.0-alpha.109` / `CFBundleVersion`: `2026.109.0`
- **源码冻结提交**：`640aab6`（分支 `rewrite/cap-foundation`）
- **候选标签**：`next-v0.2.0-alpha.109-candidate`
- **安装路径**：`/Applications/Jianku Screen Next.app`
- **回滚副本**：`/Applications/.jianku-next-update-Gs4h7w/previous.app`（`0.2.0-alpha.108` / `2026.108.0`）
- **签名方式**：本机 `jianku-dev.keychain-db` 处于锁定状态，按 `docs/开发交接.md` §12 约定使用显式 ad-hoc 签名（`APPLE_SIGNING_IDENTITY=-`）完成单进程构建与全包严格验签。

## 1. 集成范围汇总

1. **Cap 上游录制防掉帧与光标拖动对齐**（冻结前既有批次）：`SourceClockState` 跳帧检测、`CaptureInstantTimeline`/`CaptureClockDrift`、`FrameCopier` + `UserInitiated` QoS（覆盖 AVFoundation 与分片 M4S）、分片定时写入、偶数像素裁剪、摄像头中途分辨率缩放、光标免辅助功能断言与位图指纹优化、1-based 主键拖动平滑与实时演示对齐、静止淡入、exFAT 导出安全发布与 MP4 硬件编码失败自动 `libx264` 回退。
2. **画质与配置保护**（`b56898d`）：损坏 `project-config.json` 自动备份（`#4420`）、>2.2× 缩放缩略环滤波（`#4385`）、GPU 屏幕文字超分增强（`#4332`/`#4398`/`#4421`，内置 `models/screen-upscale*.bin`）。
3. **12 种片段转场**（`99dbdfa`，`#3697`）：叠化、黑/白淡入淡出、四向推入、四向擦除、缩放，含 GPU 合成着色器、音频交叉淡化与时间线面板/右键菜单。
4. **预览变速与保音高时间拉伸**（`7e57e57`，`#3689`/`#3717`）：`0.5x–3x` 预览速度切换与 `<`/`>` 快捷键，实时音频保持音高。
5. **人声均衡、防爆音淡化与响度自动平衡**（`c5aa362`，Cap `#3547`/`#3698` + DogSC `v0.2.0`）：片段级 4 段 Voice EQ（5 预设 + 高通 + 去咔嗒声）、硬切点 5 ms 自动淡化、基于 ITU-R BS.1770-4 的跨切点自动响度平衡（目标 -16 LUFS，预览/导出一致）。
6. **导出管线升级**（`1b5ad8e`，`#3479`/`#3561`/`#4036`/`#4379`/`#4394`）：MP4 多块并行 Turbo 导出（自动回退标准管线）、GIF 低/中/高画质 + 5 FPS + 480p、默认导出帧率跟随采集帧率、纯音频 MP3（192 kbps `libmp3lame`）/ WAV（16-bit 48 kHz PCM），桌面与 `cap-exporter` 同步支持。
7. **转写语气词与长停顿一键清理**（`f2ead9a`，`#3698`）：支持英文及中文常见语气词检测，一键清理语气词与剪除长停顿。
8. **摄像头 GPU 美颜与时间线框选**（`9e23ff0`，参考 DogSC `v0.2.0`）：YCbCr 肤色蒙版双边磨皮与提亮（编辑器与实时演示共用）、时间线空白区拖拽框选多段。
9. **图形与步骤序号标注轨道**（`cdec7ef`，`#3690`）：6 种图形（箭头、直线、矩形、椭圆、荧光高亮、步骤序号），独立 Metal GPU `ShapeLayer` 渲染并接入叠加层 Z 序、时间线轨道与属性面板，完整重建 `tauri.ts`。

## 2. 验签与六二进制 SHA-256 核对（源包与安装版逐字节一致）

`codesign --verify --deep --strict --verbose=2` 在源 bundle 与 `/Applications/Jianku Screen Next.app` 均返回 `valid on disk` / `satisfies its Designated Requirement`。

| 可执行文件 | SHA-256（源包 = 安装版） |
| --- | --- |
| `Jianku Screen Next` | `6cedf32949fb96169ad6ca15cb772c1768e6a879854c97cff0947538ca3f92f0` |
| `cap-cli` | `f99f1eba88b467b1bf1b73ad5c53b65feb3dc857c0d5f4ea839445df9ce0eda8` |
| `cap-exporter` | `c1387d0c80a7403aaff98f094cd6ea4331caae3a4f6ce6365fe9c9c8277de504` |
| `cap-muxer` | `f5ffec3c52a13e3c6fbb80840b3e0232a9b0545b8a7688db7543fdbb5f34d8ba` |
| `jianku-android-capture` | `b91f3f59da634f4960368f72f54e430ec2fbf1aea1b2d4dbe94112fcc1c10672` |
| `jianku-device-capture` | `083c24308268738c0f2952e8504e2d67c71fb24ee2c2f12627d3d99dc971e981` |

## 3. 自动化检查与单元测试证据

- `node scripts/jianku-unattended-check.mjs`：通过（`jianku-config.test.mjs` 3/3、`jianku-hygiene.test.mjs` 4/4、`cargo fmt --check`、`cargo check --release -p cap-desktop`、`cap-project` + `cap-rendering` 测试、完整前端生产构建）。
- `node scripts/jianku-localization-audit.mjs`：0 处占位符不匹配（zh-CN 1774 键 / en 1830 键）。
- `cargo clippy --locked --release -p cap-project -p cap-audio -p cap-rendering -p cap-editor -p cap-enc-ffmpeg -p cap-export -p cap -p cap-desktop -- -D warnings`：0 警告、0 错误通过。
- `bunx tsc --noEmit`：0 错误；改动涉及的 5 组前端 Vitest（`clip-transitions` / `timeline-tracks` / `clip-reorder` / `timeline-utils` / `i18n`）：36/36 通过。
- Rust 单元测试：`cap-project` 215/215、`cap-audio` 全量通过、`cap-rendering` 含 `shape` 29/29 + `overlay_layers` 8/8（含 Metal GPU 着色器编译验证）、`cap-enc-ffmpeg` `mp3` 3/3、`cap-export` `turbo` 5/5、`cap-editor` `preview_s` + `join_fade` 30/30。

## 4. 安装包合成工程端到端导出与启动验证

使用已安装的 `/Applications/Jianku Screen Next.app/Contents/MacOS/cap-cli`，基于 `/tmp/jianku-alpha109-verify/synth.jks`（合成 2.5s 1280×720 30fps 视频 + 48kHz 立体声音频，启用 `push-left` 转场、`arrow` + `badge` 图形轨道、`voiceEq` Clear 预设 + 轻度去咔嗒声、`autoLevel: true`、摄像头美颜配置）执行 5 组真实导出并通过 `ffprobe` 校验（未读取任何用户真实录制，验证后清理临时目录）：

| 导出模式 | 输出大小 | 媒体流与参数（`ffprobe`） | 时长 | 结果 |
| --- | --- | --- | --- | --- |
| MP4 Turbo + 屏幕画质增强（`--turbo --screen-enhance`） | 1,611,047 B | `h264 1280x720` + `aac 48000Hz 2ch`（5370 kbps） | 2.400 s | 通过 |
| MP4 标准导出 | 2,081,417 B | `h264 1280x720` + `aac 48000Hz 2ch`（6938 kbps） | 2.400 s | 通过 |
| GIF 5fps 480p | 362,438 B | `gif 856x480`（1208 kbps） | 2.400 s | 通过 |
| 纯音频 MP3 | 58,796 B | `mp3 48000Hz 2ch`（196 kbps） | 2.400 s | 通过 |
| 纯音频 WAV | 460,844 B | `pcm_s16le 48000Hz 2ch`（1536 kbps） | 2.400 s | 通过 |

同时通过 `open -a "/Applications/Jianku Screen Next.app"` 启动安装后的 `alpha.109`（PID `58452`），确认进程稳定存活、无崩溃。

## 5. 未覆盖与诚实边界

- 真实屏幕录制长时间掉帧复测、系统权限（TCC）同步偏移实测、光标拖动平滑与参考软件逐帧视觉对照仍需人工实机验收，不标为已实机通过。
- 副屏实时演示、会议软件共享、iOS/Android 实机录制及 Windows/Linux 打包继续延期。
- 本次构建为显式 ad-hoc 签名，如需触发系统屏幕录制权限请从访达或 Dock 启动并按系统提示重新授权。
