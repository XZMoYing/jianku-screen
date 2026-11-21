# 2026-11-21：上游功能全量集成与 `0.2.0-alpha.109` 打包安装

## 完成事项
1. 完成 Cap (`0.6.1–0.6.3` / `main`) 与 DogSC (`v0.2.0`) 上游能力分批集成（7 个原子提交：`b56898d`、`99dbdfa`、`7e57e57`、`c5aa362`、`1b5ad8e`、`f2ead9a`、`9e23ff0`、`cdec7ef`）：
   - 损坏配置备份、`>2.2×` 缩略环滤波、GPU 屏幕文字超分增强；
   - 12 种片段转场（GPU + 音频交叉淡化 + 编辑器 UI）；
   - `0.5x–3x` 保音高预览变速；
   - 片段级 4 段 Voice EQ + 去咔嗒声 + 硬切点 5 ms 淡化 + ITU-R BS.1770-4 自动响度平衡；
   - 多块并行 Turbo MP4 导出、GIF 质量预设 / 5 FPS / 480p、采集帧率默认导出、纯音频 MP3/WAV 导出（桌面与 `cap-exporter` 同步）；
   - 中英文转写语气词与长停顿一键检测清理；
   - GPU 摄像头美颜滤镜与时间线空白区框选多段；
   - 6 种图形/步骤标注轨道（GPU `ShapeLayer` + 叠加层 Z 序 + 属性面板）并重建 `tauri.ts`。
2. 修复全部 8 个 Rust crate 的 Clippy 告警，实现 `cargo clippy --locked --release -- -D warnings` 0 警告、`tsc --noEmit` 0 错误、`jianku-unattended-check.mjs` 与 `jianku-localization-audit.mjs` 通过。
3. 更新 `next/cap/JIANKU-NOTICE.md`，升级版本至 `0.2.0-alpha.109` / `2026.109.0`，冻结提交 `640aab6`，打候选标签 `next-v0.2.0-alpha.109-candidate`。
4. 因 `jianku-dev.keychain-db` 锁定，按 `docs/开发交接.md` §12 使用 `APPLE_SIGNING_IDENTITY=- node scripts/jianku.mjs release` 构建并完成严格验签，源包与 `/Applications/Jianku Screen Next.app` 六二进制 SHA-256 全部一致，旧版 `alpha.108` 保留在 `/Applications/.jianku-next-update-Gs4h7w/previous.app`。
5. 使用已安装 `cap-cli` 对合成 `.jks` 工程完成 MP4 Turbo + 屏幕增强、MP4 标准、GIF 5fps 480p、MP3、WAV 五组端到端导出并经 `ffprobe` 校验通过，同时正常启动新版 `alpha.109`（PID `58452`）。

## 证据路径
- `next/verification/2026-11-21-alpha109-upstream-sync/README.md`

## 下一续 / 待实机验收
- 实机录制长时段掉帧复测与光标拖动平滑对照；
- 授权屏幕录制权限后运行 U10b3b3 同步测试；
- 真实 UI 下逐项体验新功能（12 转场、预览变速、Voice EQ / 响度平衡、Turbo / MP3 / WAV 导出、美颜、时间线框选、图形标注轨道）。
