# 0.1.6 默认比例与交互预览验证

2026-10-11，Apple M1、16 GiB、macOS 14.7.4、Qt 6.11.2；Release 构建。

默认 `auto` 选项显示为“适合屏幕”，保留 16:9、16:10、4:3、1:1、9:16、21:9。`auto` 随保留的源画面比例；演示的实际输出画布仍随目标显示器/输出窗口比例。已有工程及用户保存的比例不被重置。

| 实际窗口，3360×2100 / 30 fps 合成素材 | 适合屏幕 | 16:9 |
| --- | --- | --- |
| 预览尺寸 | 864×540 | 960×540 |
| 连续 3 秒按住留白滑块的移动事件 | 94 | 94 |
| 按住期间的实际新预览帧 | 67 | 67 |
| 参数到对应画面的 P95 延迟 | 14.63 ms | 16.17 ms |
| 松手到最终画面 | 29 ms | 31 ms |
| 拖动期间整段动画重建 / 视频定位 | 0 / 0 | 0 / 0 |
| 界面心跳 P95 | 9.00 ms | 10.32 ms |

移动事件不一定改变值，滑块有 0.5% 步长；不把重复值未重绘算成卡顿。两种比例下，恢复原参数后的整张图逐像素一致；播放中同时修改圆角、内框、阴影距离/强度仍继续推进，3 秒内分别交付 87 / 79 帧，没有整段动画重建或定位。保存最终参数通过。具体结果在 `appearance-*-result.json`。

- `live-canvas-*-result.json`：保持 3360×2100 的完整背景/阴影图像，不降低分辨率。后台生成、缓存、并行及不透明区域处理后，3 秒内交付由 21 次提升至 32 次，最终值延迟由 474 ms 降至 155 ms；界面心跳 P95 约 9 ms，最终背景和阴影逐像素一致。此压力测试的完整图像生成约 11 次/秒，不应写成全分辨率参数动画达到 60 fps。
- `shadow-baseline/`：本轮不透明区域/写入合并优化前捕获的本项目 32 张阴影图，不是竞品输出。小数尺寸、小数模糊、不同圆角/透明度/距离/滤波次数全部逐像素通过；参考函数保存在 `shadow-before-roi.cpp`。
- `ctest.log`：19/19 回归通过，包含先前九张整帧图像逐像素对比、动态模糊算法、外观撤销/保存、真实导出。
- `focus-result.json`、`crop-result.json`：实际窗口焦点、裁切、最小窗口确认、撤销、源坐标逆映射及 Metal 纹理裁切通过。裁切检查的硬编码像素输入针对 `tests/create_editor_fixture.py` 的 960×600 样本，不能替换成大分辨率预览样本后仍使用原断言。
- `playback-*-result.json`：三个大分辨率连续播放样本为 48.24 / 39.05 / 46.71 fps，未达到验证器预设的 ≥50 fps 门限。没有定位或动画重建；交互/图像一致通过不等于播放满帧。同期系统约使用 5.26 GiB swap，存在会议、录屏及较高 WindowServer 负载；尚无同环境旧版对照，不据此归因，也不能称播放性能验证全部通过。待验证交接保留此项。
- `package.log`、`signature.txt`、`native-window-check.json`、`verification.json`：安装包、签名、实际打开及源码/产物指纹。打包脚本中的 offscreen Abort trap 是预期依赖隔离检查，实际 Cocoa 窗口另行核实。

复现：Qt 的工具目录加入 PATH 后执行 `python3 research/evidence/2026-10-11-interactive/run-checks.py`；只检查阴影可加 `--shadow-only`。实际窗口交互使用测试构建的 `--verify-editor PROJECT --verification-output DIR --verify-appearance`；保持样本目录隔离，验证过程会编辑并保存它。播放用 `--verify-performance --require-smooth-preview`，保留失败结果。裁切先用 `python3 tests/create_editor_fixture.py /tmp/FRESH-CROP.jianku --focus` 生成对应样本。
