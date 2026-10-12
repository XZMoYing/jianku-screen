# 系统光标大小与热点验证（0.2.0-alpha.5）

针对停止后仍存在的轻微箭头偏移，以及辅助功能尺寸下的外形识别。源码结论见 [核查说明](../../../research/2026-10-12-系统光标大小兼容.md)，机器结果见 [verification.json](verification.json)。全部未完成验收只维护在 [待验证项目交接](../../../docs/待验证项目交接.md)。

- `shape-tests.log`、`capture-tests.log`、`position-tests.log`：外形、空值与缓存、录制资产身份、Retina 热点和小数坐标映射。
- `system-probe.log`：保持用户当前约 1.4044 倍系统大小，主线程及模拟录制线程各检查六种标准光标。只记录外形、尺寸和热点，没有更改系统设置或保存系统光标图像。
- `gpu-tests.log`：实际 Metal 上的 54 组旋转热点、72 组缩小取样及三种尺寸的实际箭头尖端检查；旧算法的可复现偏移也在测试中测量。
- `render-tests.log`：既有外形选择、闲置隐藏、尺寸、模糊、缩小纹理和透明边缘回归。
- `initial-build.log`、`native-build.log`：两次编译、打包均完成，构建包装器在签名阶段遇到 `errSecInternalComponent`，退出码 1；`signature-recovery.log` 对最终同一个包补签，`final-signature.log` 严格验证仓库外试用包。
- `export-comparison.json`、`*-frames.md5`、`*-probe.json`：最终打包导出器的实际输出、完整解码、逐帧 RGBA 与时间戳。静止箭头锚点修正有意改变 SVG 画面；未旋转的原始位图用于验证其他画面与动画仍然保留。

## 复现

在 `next/cap` 执行 `cargo test -p cap-cursor-info --lib`、`cargo test -p cap-cursor-capture --lib`、`cargo test -p cap-recording --lib cursor::` 与 `cargo test -p cap-rendering --test cursor_texture_edges -- --nocapture`。`cargo run -p cap-cursor-info --example system-cursor-check` 只读取本机当前光标设置，不调整全局指针大小。

测试工程用自建底座素材 `../2026-10-12-native-foundation/fixture.cap` 与本目录 `fixture-overrides/tilted` 或 `unrotated` 重建；两者都是六秒合成素材，无用户录制画面或个人背景。外部试用工程在 `~/Movies/Jianku Screen Next/试用 0.2.0-alpha.5/`。不得用可被用户修改的试用工程作为唯一历史输入。

运行时外形识别只用于之后的捕获，新的小数精度不能恢复旧事件已经丢失的部分。已有工程会通过共享渲染器应用本轮经典箭头锚点和旋转修正；旧工程中的未知自定义图像仍使用原始资产。调试包、合成标记与文件导出通过不等于所有真实录制、持续预览性能或参考动画一致均已验收。
