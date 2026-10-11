# 光标姿态接入验证（2026-10-12）

本阶段为 0.2.0-alpha.2 调试试用，接入倾斜和点击形变，保留原始位置平滑、镜头、3D、动态模糊与画面配置。结论、源码和输出哈希见 [verification.json](verification.json)；所有未完成验收只维护在 [待验证项目交接](../../../docs/待验证项目交接.md)。

## 可重现输入

复制上一阶段 `../2026-10-12-native-foundation/fixture.cap`，再把 `fixture-overrides/` 覆盖到副本的同名路径。输入视频和光标 PNG 沿用该目录已经归档的自建素材；新增移动为 60 Hz、361 条事件，点击 10 条，涵盖急停、折返、连击和长拖动。旋转量在示例中设为 0.5，方便观察；产品默认值仍为 0.15。保留六秒 30 fps 输入、1.0–3.7 秒缩放区间、背景/留白/圆角/阴影及默认模糊。

工程位于 `~/Movies/Jianku Screen Next/试用 0.2.0-alpha.2/光标动画验证.cap`。编辑器首次打开可能生成 `clips`，原生预览测试使用另外的临时副本，不修改归档。媒体不包含用户画面、账户或个人录制。

## 计算与 GPU 验证

在 `next/cap` 中执行：

```sh
cargo test --locked -p cap-rendering --lib cursor_interpolation
cargo test --locked -p cap-rendering --lib numeric_spring
cargo test --locked -p cap-rendering --lib cursor_pose -- --nocapture
cargo test --locked -p cap-editor --lib preview_cursor_cache
cargo test --locked -p cap-editor --lib raw_preview_cache
cargo test --locked -p cap-rendering --lib cursor_pose_setup_and_cached_sampling_benchmark -- --ignored --nocapture
```

`numeric-spring.csv` 位于 `cap/crates/rendering/test-data/`。用本目录 `numerical-reference.cpp` 和旧版 `src/animation/SpringSolver.cpp/.h` 在 Xcode 16.2 的 C++ 编译器生成 60 步轨迹，记录倾斜反向、条件参数切换及连续点击的数值与速度。Rust 测试误差上限为 1e-6；这验证求解器移植，不是官方软件输出对照。可在 `next/cap` 目录重现 C++ 输出：

```sh
xcrun clang++ -std=c++17 -O2 -I ../../src/animation \
  ../verification/2026-10-12-cursor-pose/numerical-reference.cpp \
  ../../src/animation/SpringSolver.cpp -o /tmp/jianku-numerical-reference
/tmp/jianku-numerical-reference > /tmp/numeric-spring.csv
cmp /tmp/numeric-spring.csv crates/rendering/test-data/numeric-spring.csv
```


原生 GPU 测试使用 Apple M1 / Metal，比较直接计算和缓存计算的完整帧像素，并确认输出分辨率不会改变倾斜和点击尺度。位置平滑原有数值回归继续保留，新增姿态缓存的参数键、容量、定位和原始模式覆盖。首轮交叠鼠标键用例因错误假设弹簧在 250 ms 内完全收敛而失败；改为和同一时刻一直按住的独立轨迹比较后通过，保留首轮日志。

十分钟合成轨迹的姿态准备与缓存查询计时、原生编辑实例单帧输出，只是调试链路数据，不代表持续播放帧率、参数拖动延迟、正式版或 Windows 性能。

## 打包与导出

```sh
bun run jianku:build
"/path/to/0.2.0-alpha.2/Jianku Screen Next.app/Contents/MacOS/cap-exporter" export \
  /path/to/fixture-copy.cap --output /path/to/after.mp4 \
  --fps 60 --resolution 1280x800 --quality maximum --json
```

在同一自建输入上分别运行已保留的 alpha.1 和 alpha.2 导出器，保存修改前后视频到仓库外的试用目录。最终 alpha.2 输出 1280×800 / 60 fps / 360 帧，完整解码通过，并检查缩放前后画面。导出 JSON、探测、完整解码、选定帧和签名日志归档。

最终编译和打包成功后，构建入口在签名时因本机开发钥匙串锁定返回 1；本地解锁后补签同一应用，复制后的严格签名检查通过。`final-build.log` 保留失败，`final-signature.log` 记录恢复；未更改凭证、源代码或签名身份。

用户确认已退出且没有需要保留的编辑后，旧 alpha.1 正常退出。新应用路径和 PID 59880 由原生检查确认，测试工程的编辑窗口 1275×800 可见，日志记录首帧送达窗口。首次带 `--args` 启动仅打开主界面，随后发送明确的文件打开事件载入工程；实际启动以 `editor-windows.json` 和 `desktop-editor.log` 为准，不把 `open` 返回成功当成已运行编辑器。用户的视觉验收尚未完成。

本阶段仍未完成参考软件受控输入的逐帧一致验证，也未接入实时演示。60 Hz 姿态预计算、事件目标、Retina 单位、不同帧率、样式和长工程须继续验证；继承的编辑功能与截图/音频/云入口仍按交接清单推进。
