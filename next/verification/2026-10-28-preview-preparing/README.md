# U04b：准备阶段、首帧与清晰度接管

2026-10-28，基线 `8067de56057e370fdc89a32bc1b6682ce4a85a9e`。本项为源码与原生组件验证，当前安装仍为 alpha.39。U04c 尚需完整应用打包、菜单操作及导出独立性检查；不能据此关闭 U04 总项。

## 修改范围

准备播放器等待实际屏幕/摄像头尺寸及 GPU 限制，再从与普通播放器相同的原生分辨率目录计算首帧。偏好高于小素材能力时回退原始画布，保留用户偏好。新的清晰度命令只改变后续渲染尺寸：不重新定位、不重建音频、不使已经预留的接管失效；暂停时也会补出相同时间点的新尺寸画面。旧 API 的明确固定分辨率仍保留给既有调用方。

桌面实例的初始帧、准备接管及候选重建均读取存储偏好和实际画布，删除旧 1248×702 固定默认。前端更新质量时不再重新发起播放接管；连接首帧读取存储偏好，后续画布重连读取当前有效选择。初始化偏好在编辑器内容出现前读取，避免异步默认覆盖用户操作。

普通缩放、3D 动画、光标、构图/像素对齐数学、编码和导出设置均未修改。接口通过 Rust 的生成测试更新，不手改 `tauri.ts`。

## 验证与边界

- 原生准备质量测试实际解码/渲染 160×120 合成视频，固定 9:16 画布。偏好 720p 时收到 160×286 原始上限，144p 时收到 144×258（沿用原生对齐），检查真实 RGBA 数据长度与行跨度。
- 暂停位置不变；清晰度命令与 0.5 秒定位并发，两者均成功；播放中来回切换，音频代次不变、样本继续增加，时间没有倒退；预留接管未因质量变化失效；正常停止及后台回收通过。
- 既有原生 PCM 接管/候选销毁/重启前回收测试单独运行，用于防止修改质量命令后破坏跨阶段音频连续性。
- 桌面默认质量测试使用共享枚举与真实源限制，验证横屏 4K→1280×720、竖屏 4K→720×1280、小源→640×360，替代旧硬编码“与前端一致”的误导性断言。
- 前端实际桌面配置中，分辨率、预览边界、准备订阅/传输/租约、交接和播放意图等 10 文件 104 项通过。初次从根目录执行缺少桌面 alias，3 文件未加载；保留初次日志，正确目录重跑全部通过。

本项不证明实际窗口持续 60fps、所有工程/物理设备和目标平台均可用。既有两项严格解码色度失败仍保留为发布阻塞；没有放松门限或切换为全局软件解码。对应历史证据见相邻 `2026-10-27-decoder-parity`。

## 重跑命令

在 `next/cap/`，设置对应原生库路径、Xcode 和 Cargo 环境后：

```sh
cargo check --locked --release -p cap-desktop
cargo test --locked --release -p cap-editor --lib preparing_preview::native_tests::native_preparing_quality_preserves_paused_seek_audio_and_source_ceiling -- --exact --test-threads=1
cargo test --locked --release -p cap-editor --lib preparing_preview::native_tests::native_handoff_reuses_pcm_preserves_audio_across_candidate_disposal_and_joins_before_restart -- --exact --test-threads=1
cargo test --locked --release -p cap-desktop --lib tests::editor_preview_uses_native_source_limits_and_shared_default_quality -- --exact --test-threads=1
cargo clippy --locked --release -p cap-rendering -p cap-editor --lib -- -D warnings
```

实际接口生成在 `apps/desktop/src-tauri/` 执行 `cargo test --locked --release -p cap-desktop --lib typescript_bindings_tests::export_typescript_bindings -- --exact --test-threads=1`，确保生成器相对路径正确。

TypeScript 使用 `node node_modules/typescript/bin/tsc --noEmit -p apps/desktop/tsconfig.json`；完整静态前端使用 `node scripts/jianku.mjs frontend`。Vitest 从 `apps/desktop/` 使用该目录的配置。检查结果、源指纹与压缩日志在本目录，不包含用户工程或账号内容。

## 最终检查结果

桌面 release check、3 项分辨率目录检查（140 组合）、28 项播放回归、1 项原生准备质量检查、1 项原生 PCM 接管检查和 1 项桌面默认检查均通过。实际原生接口生成、TypeScript、完整静态前端、渲染/编辑核心严格 Clippy、Rust 格式及改动的 TS Biome 检查通过。完整结果与源指纹见 `checks.json`；保留初次错误调用日志，未用它们代替最终通过结果。

应用仍 alpha.39。本次只交付源码检查点；下一项 U04c 生成并验收新阶段包后再更新安装版本和 U04 总项状态。
