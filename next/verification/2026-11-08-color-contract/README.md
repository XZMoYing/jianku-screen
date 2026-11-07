# 预览/导出色彩契约实测（alpha.97，U11a 取证）

`U11a` 要求：核对实际预览/导出色彩契约，GPU `rgba_to_nv12.wgsl` 数值系数与硬件编码上下文标签疑似不一致，用标准色块实测 RGBA、GPU/CPU NV12 与最终视频后决定修复。本轮完成纯色端到端实测与源码审计。

## 方法

- 合成工程：复制自有工程，把 `content/display.mp4` 替换为 640×360、8 s 纯色视频（red／gray／blue，libx264 yuv420p，标记 bt709/tv），清除字幕/文本/样式/图片/缩放/遮罩/按键/音频/3D/场景，仅保留主轨 0–8，导出参数 `--resolution 640x360 --fps 30 --quality maximum`。
- 工具：`cap-cli --json export`（与桌面应用同一渲染/编码源码，alpha.97 源码构建）。
- 测量：解码源视频与导出视频首帧中心像素 RGB 与 YUV（ffmpeg）；读取导出码流色彩标签。

## 实测结果

| 颜色 | 源（RGB） | 导出（RGB） | 源 YUV | 导出 YUV |
| --- | --- | --- | --- | --- |
| red | 252,0,0 | **225,0,0** | 62,102,239 | 57,105,227 |
| gray | 125,127,127 | **113,116,113** | 125,128,127 | 115,127,127 |
| blue | 0,0,251 | **1,0,237** | 31,239,117 | 31,232,119 |

- 导出码流标签：`color_range=tv, color_space=bt709, color_primaries=bt709, color_transfer=bt709`（h264/yuv420p）。
- 同一纯色内容导出后明显变暗/降饱和（红 252→225、蓝 251→237、灰整体约 -12），导出帧在视频区域内均匀，排除背景/缩放干扰。

## 源码审计

- `crates/rendering/src/shaders/rgba_to_nv12.wgsl`：编码使用 **BT.601 limited** 系数（Y=16+65.481R+128.553G+24.966B，U/V 为 601 系数）。
- `crates/rendering/src/shaders/nv12_to_rgba.wgsl`：解码同样固定 **BT.601 limited**（1.164/1.596/0.391/0.813/2.018）。
- `crates/enc-ffmpeg/src/video/{h264,hevc}.rs`：显式设置 `color_space=BT709`、`color_range=MPEG`、`color_primaries/color_trc=BT709`；导出的纯色视频通常也带 BT.709 标签，但被固定 601 着色器解码。
- 结论：**着色器系数/解码矩阵与码流标签不一致**；灰阶整体变暗提示除矩阵外还可能有 gamma/纹理格式或范围处理问题，需单元级验证分离。

## 下一步（U11a2）

1. 对 `RgbaToNv12Converter` 增加已知 RGBA（黑/白/红/绿/蓝/灰）→ YUV 的单元断言，明确当前是 601 还是 709 limited；
2. 统一到与编码器标签一致的 BT.709 limited（同时输入解码按流标签或统一 709），并处理 gamma/范围；
3. 用本轮纯色夹具回归导出 RGB（目标与源误差 ≤2/255）、预览与导出一致、CPU/GPU 路径一致；未修复前 U11a 不关闭。

## 未覆盖

- GPU/CPU 转换逐通道单元对比、预览画面与导出对比、不同编码器/quality/10bit、透明窗/HDR/广色域显示器；未使用用户真实工程。

## 证据文件

- `color-contract-summary.json`：源/导出 RGB·YUV、码流标签、源码审计、结论与候选根因。
- `red-src.mp4`、`gray-src.mp4`、`blue-src.mp4`、`*-export.mp4`：纯色源与导出视频。
- `*-export.log`：CLI 导出日志。
- `run-color-contract.py`：工程替换、导出与测量脚本。
