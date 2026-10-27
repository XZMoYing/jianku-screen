# U04a：实际像素分辨率与普通播放更新组件

日期：2026-10-28。基线 `67133575803066dead35de5acd3056780ff5fc00`，当前安装仍是 alpha.39。本项为源码/组件检查，不是新版本交付；U04 的准备阶段、交接及打包界面检查尚未完成。

## 已实现的边界

旧预览使用固定 1920×1080 上限的 100%/65%/25%，标签不能反映竖屏或其他比例的实际像素。现在原生 catalogue 复用 `ProjectUniforms::get_base_size/get_output_size`，提供 144p、360p、480p、540p、720p、1080p、2K（1440p）、4K（2160p）和原始清晰度；p 表示画布短边，菜单列真实对齐后的宽高。沿用渲染器的宽 4/高 2 像素对齐，未修改已认可的构图或动画数学。

超过当前原始画布或 GPU/8192 像素预览限制的选项禁用；偏好超出当前源时显示原始清晰度，保留偏好供其他工程使用。原始画布仍超过设备/预览限制时显示“最高可用”。画布自然尺寸包含留白和固定比例的背景区域，不是直接拿录制短边当作上限，也不是放大原素材伪造更高清晰度。旧 quarter/half/full 读取为 360p/720p/1080p，新默认为 720p，设置仅影响编辑器预览。

普通播放通过 watch 更新已有 PlaybackHandle 的尺寸，逐帧取一次值供转场两侧共用，不停止解码、音频或时钟；暂停/定位等仍走原渲染链。前端只在画幅、裁剪或留白改变时重新查询 catalogue，保护最新请求并串行更新播放尺寸；下拉菜单与中英标签已接线。

## 已完成的证据

- 3 项原生 catalogue 检查通过，包含 140 种源尺寸/比例/留白组合以及裁剪、设备限制和旧设置迁移。
- 28 项既有播放相关检查、19 项前端选择/布局/语言检查通过。完整桌面 release check、原生接口生成测试、TypeScript、完整静态前端、格式及渲染库/编辑库/检查程序严格 Clippy 通过。生成的 `tauri.ts` 没有手工编辑。
- 原生 `preview-resolution-check` 只接受带本轮标记的独立合成工程。实际 640×360 和原生 3840×2160/60fps 素材完成 **18 次 GPU 缓存尺寸观察**，包括全部八个 p 档位、原始清晰度、竖屏、方形和 320×240 裁剪。实际 RGBA 缓存长度/行跨度与宽高有效，帧号不倒退；每个进程仅一次播放时钟、一次预热、一次音频初始化，且收到真实音频样本。结果见 `small-gpu.json` / `large-gpu.json`。它不证明实际显示窗口持续 60fps 或所有复杂工程的性能。

示例中，144p 实收 256×144，480p 为 856×480（原生对齐），720p 为 1280×720，竖屏为 720×1280，2K 为 2560×1440，4K 为 3840×2160。小素材上 480p 以上不可用，原始画布含留白时为 712×400；没有上采样成 1080p。

初次类型检查调用了不存在的 package script，在运行检查前中止；随后真实 TypeScript 编译器检查通过，分别保留 `typecheck.log.gz` 与 `typecheck-final.log.gz`，没有把错误调用计为产品检查通过。

## 必须继续的分支

深查发现 Rust 的早期 PreparingPlayback 及 `create_editor_instance_impl` 初始交接仍调用旧固定 1248×702 helper，旧“匹配前端”测试只是硬编码断言，不能证明现在两端一致。当前新菜单/普通播放组件通过不等于准备阶段已统一。U04b 必须把这条链也接到来源感知的清晰度，复核初始首帧、准备中播放与普通接管；然后 U04c 再打包并实际检查菜单、帧尺寸、播放中切换、保存/重开与导出设置独立性。现在没有发布或安装带这项修改的新应用，不能将 U04 勾为完成。

原有两项严格硬件解码色度差异、读回时序、U05 全屏、完整中文/审计及 Windows/Linux 仍待办；父级目标保持。

## 重跑

从 `next/cap/` 用 `python3 ../verification/2026-10-28-preview-resolution/make-fixtures.py --source <U18c whole.jks> --directory <新目录> --ffmpeg <ffmpeg>` 生成两个独立合成工程。输入指纹见 `input-fingerprints.json`；脚本拒绝覆盖和用户来源工程。

构建 `cargo build --locked --release -p cap-editor --example preview-resolution-check`，设置目标平台原生库环境后，运行 `target/release/examples/preview-resolution-check <small.jks 或 large.jks> <新JSON报告>`。macOS 程序保留主线程消息循环，让动态背景走实际 AVPlayer 路径。完整日志压缩保存在本目录；临时工程在 `/private/tmp/jianku-preview-resolution/cases/`，当前相邻阶段仍要使用，不清理。
