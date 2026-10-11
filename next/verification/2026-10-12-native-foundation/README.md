# 原生底座与试用验证（2026-10-12）

本阶段使用 Xcode 16.2，在 macOS 14.7.4 / Apple Silicon 构建 `com.jianku.screen.next` 的 0.2.0-alpha.1 调试应用。事实与范围见 [verification.json](verification.json)，全部未完成事项仍只维护在 [待验证项目交接](../../../docs/待验证项目交接.md)。

`native-final-build.log` 为完整打包入口的成功日志。此前调试签名缺少资源封印，以及一次钥匙串阻塞的诊断记录也保留；最终应用使用本机既有开发证书通过严格验证，没有 Developer ID 公证。打包后的应用从仓库外独立目录运行。原生窗口检查只读取本应用标识、路径、进程和窗口边界，不采集桌面截图。

`fixture.cap` 是本项目自建的六秒 960×600 / 30 fps 合成色条素材，含光标、两次点击、背景/圆角/阴影和一个 1.0–3.7 秒的 1.8 倍缩放区间；默认运动模糊保持开启。它用于验证媒体底座，不能作为参考动画已一致的证据。当前目录完整保存小型输入，Git 只对该合成输入视频添加精确例外，其余录像和大型参考素材继续忽略。

可在 `next/cap` 中重现原生实例的单帧检查：

```sh
cargo run --locked -p cap-editor --example editor-startup-benchmark -- \
  --recording-path ../verification/2026-10-12-native-foundation/fixture.cap \
  --runs 1 --preview-time 1.7
```

该上游工具可能为旧版工程配置生成 `clips`，请使用合成输入副本，避免改动归档。检查只要求十秒内产生帧，不代表连续播放满帧。保存的输入对应导出验证时的配置；实际试用副本随后由编辑器正常转换。

打包内导出程序验证命令：

```sh
"/path/to/Jianku Screen Next.app/Contents/MacOS/cap-exporter" export \
  /path/to/fixture-copy.cap --output /path/to/output.mp4 \
  --fps 60 --resolution 1280x800 --quality maximum --json
```

`bundled-export.jsonl` 和 `export-probe.json` 记录 H.264 / 1280×800 / 60 fps / 360 帧 / 六秒结果；合成输入没有录制声音，输出 AAC 为静音。`export-unzoomed.png` 与 `export-zoomed.png` 只用于检查光标和画面包装可见，未做参考软件逐帧对照。默认动画和媒体核心相对原始导入无改动。

用户确认首次授权后停止录制能自动打开编辑器。`real-recording-validation.json` 只保存实际工程的结构和计数，不保存用户屏幕内容或原始工程。此次无麦克风的实际显示器录制有 686 帧和完整光标事件。默认 null 输出检查出现输出 DTS 告警；`real-recording-timebase.json` 显示原始 PTS 严格递增，使用 `-fps_mode passthrough -enc_time_base demux` 后完整解码无告警，原视频保持原样。

此阶段并不表示截图、音频、完整编辑交互、持续播放性能、优化发布版、目标动画一致、实时演示、Windows 或旧工程迁移已经完成。
