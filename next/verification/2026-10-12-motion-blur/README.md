# 动态模糊校准验证（2026-10-12）

本阶段为 0.2.0-alpha.3 调试试用，校准缩回中心和 21 次平移取样，不更改模糊强度、帧率归一化、画面预设或运动参数。最终运行状态和哈希见 [verification.json](verification.json)，全部待验证事项仍以 [交接清单](../../../docs/待验证项目交接.md) 为唯一入口。

## 依据与边界

沿用已归档的 [动画差异研究](../../../research/2026-10-11-Cap-动画差异研究.md)及其 [定位/哈希清单](../../../research/evidence/2026-10-11-cap/manifest.json)。偏侧缩回优先求对应角点运动线交点；平移分布为中心一份，加 `0/20..19/20` 共 20 份，重心为运动向量的 `9.5/21`。原有包含关系分支会丢失偏侧枢轴；原采样分布重心为 `0.5`。源代码、数学期望和 GPU 输出相互核对，不能替代参考应用的受控逐帧导出。

无交点时的回退、UV 中心限幅、缩放噪声与 13 次加权采样、父子运动、透明度和 3D 路径本轮保留。不会把这些保留路径说成已达到完整目标。

## 复现输入与检查

复制 `../2026-10-12-native-foundation/fixture.cap`，把本目录 `fixture-overrides/` 覆盖至同名路径。`fixture-assets.json` 确认视频和 PNG 仍是已归档的自建素材；无用户画面。输入六秒、960×600、30 fps，输出 1280×800、60 fps；手动焦点为 `(0.8, 0.3)`，倍率 2×，缩放区间 1.0–3.7 秒；光标输入沿用上一阶段急停、折返、点击和拖拽轨迹。

归档对照使用自建的固定色背景，以消除本机图片路径依赖；正在试用的工程保留用户此前选择的背景，不归档桌面背景图片。关闭模糊对照是固定背景工程副本，仅将 `screenMotionBlur` 与 `cursor.motionBlur` 设为 0。试用与视频位于 `~/Movies/Jianku Screen Next/试用 0.2.0-alpha.3/`，原 alpha.2 工程和应用保留。

在 `next/cap` 运行：

```sh
cargo fmt --all --check
cargo check --locked -p cap-rendering
cargo test --locked -p cap-rendering --lib motion_blur -- --nocapture
cargo test --locked -p cap-rendering --lib display_
cargo test --locked -p cap-rendering --lib overlay_layers::native_tests -- --nocapture
cargo test --locked -p cap-rendering --lib cursor_interpolation
bun run jianku:build
```

几何用例按给定缩放枢轴建立画面，涵盖左右、两个对角边角、中心、不同长宽比和偏移，共 60 组，检查相同枢轴的缩入/缩回。真实 Metal shader 使用自建线性渐变独立核对四个方向的重心，并检查透明光标拖影；不是只测 CPU 常量。普通布局、图层、场景切换、原有光标回归同时检查。

修改前的中心和 GPU 重心检查失败，日志保留。最初光标 GPU 测试误用了当前 wgpu 不支持的附件字段，删除字段后在未修改 shader 上复现差异；随后边角用例暴露几乎静止角点的浮点误差，改进交点算法后通过，保留中间失败日志。未降低检查标准。

测试筛选存在交叉，唯一通过用例数由各日志中的名称去重计算；两个忽略项为既有手动计时测试。本阶段不以调试测试耗时或一次预览代表正式版/持续播放性能。

视频完整解码后的帧哈希按视频轨筛选；最初把静音 AAC 数据行也计为视频帧导致数量断言失败，修正筛选后继续要求 360 个视频帧及完整时间戳相同，不改验收条件。固定背景对照的媒体、逐帧结果、版本与输出哈希见最终记录。
