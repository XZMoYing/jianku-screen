# 准备预览与正式预览：解码色度差异定位

日期：2026-10-27。基线为 `cb42e8bb18a3fe2b18cd9f82695ef3644d50f10a`，应用继续使用 `0.2.0-alpha.37`。本轮交付可重复的诊断与检查证据，产品源码已逐文件恢复到基线，没有发布 alpha.38，也没有关闭两项画面差异。

## 已确认的范围

准备预览使用内置 FFmpeg 的 VideoToolbox 路径，正式编辑器默认使用 AVAssetReader。对同一份合成屏幕/摄像头媒体、同一源帧分层检查：

1. **差异在合成之前已存在于色度平面。** 四个时间线位置、两条轨道的亮度 Y 完全相同，UV 有少量不同。首帧屏幕 UV 4 字节、最大差 4；摄像头 UV 148 字节、最大差 3。其他位置见 [平面及合成比较](comparison.json)。同一帧亮度与源帧编号核对，避免把不同时间的画面误判为颜色问题。
2. **直接纹理导入与内存上传的输出相同。** 探针在不释放底层图像的情况下读取平面，之后另跑强制物化内存的诊断；16 对完整 RGBA 输出逐字节相同，包含 PNG/SVG 光标和四个位置。原首帧输出哈希与 alpha.37 失败基线相同。这将当前差异与 IOSurface 导入/上传及合成路径分开，但不代表所有 GPU 场景验收完成。
3. **独立程序可复现，脱离产品工程封装、异步预览和 GPU 合成。** 使用实际捆绑的 libavcodec，以同一最终文件连续读取每轨 110 帧；FFmpeg 软件路径与 AVAssetReader 全部 NV12 可见字节相同，VideoToolbox 路径存在色度差异，亮度仍全部相同。硬件上下文在打开解码器之前或之后设置，结果一样；原生 CVPixelBuffer 与下载后的内存像素也完全相同。

| 独立对照（每轨 110 帧） | 不同 Y 字节 | 不同 UV 字节 | UV 最大差 |
| --- | ---: | ---: | ---: |
| 屏幕：FFmpeg VideoToolbox / AVAssetReader | 0 | 2952 | 9 |
| 摄像头：FFmpeg VideoToolbox / AVAssetReader | 0 | 9986 | 9 |
| 屏幕：FFmpeg 软件 / AVAssetReader | 0 | 0 | 0 |
| 摄像头：FFmpeg 软件 / AVAssetReader | 0 | 0 | 0 |

这是这两份小尺寸、高频合成输入的结果，不能推广成所有 H.264/分辨率/设备的结论。初始化早/晚两次比较使用同一批帧，不能相加当作独立素材数量。见 [已实际重跑的独立复现报告](portable-reproduction.json)。

## 已排除的候选与未解决处

- AVAssetReader 显式尺寸/原始尺寸输出相同。直接 VideoToolbox 的默认、请求硬件、禁用硬件三种设置也得到与 AVAssetReader 相同的采样平面；见 [尺寸设置](av-settings-comparison.json)、[VideoToolbox 设置](vt-settings-comparison.json)。
- 用简化格式描述、匹配的输出纹理属性、去掉时间/大小信息等组合，仍未消除当前差异。独立 FFmpeg 的原生缓冲与下载平面相同。见 [格式描述](vt-description-comparison.json)、[样本信息](vt-timing-comparison.json)、[内置解码器原生/内存比较](ffmpeg-native-comparison.json)及[样本大小补充](ffmpeg-size-array-comparison.json)。
- 捕获的 FFmpeg/AVC 配置字节完全相同，已比较的 14 个压缩样本字节也相同；这些采样不能证明两套内部实现所有调用/属性完全等价。见 [配置](avcc-comparison.json)、[压缩样本](packet-comparison.json)。

目前定位到内置 FFmpeg VideoToolbox 调用路径与系统解码路径的差异，**仍未确认该路径内部的具体原因或验证出修复方案**。保留两项严格整帧失败，不把“源解码存在差异”表述成可以忽略的误差，不通过色彩补偿或放宽断言关闭问题。后续继续核对会话/样本调用，并在代表性尺寸验证候选方案及性能；全局切换到软件解码尚未作为产品方案验证。

## 严格检查与诊断的区别

临时探针为了遍历所有采样位置，将对应的合成画面对照断言临时换成文件采样；[探针日志](diagnostic-surface.log)和[内存路径日志](diagnostic-cpu.log)中的 `ok` **只表示采样结束，不是原来的画面一致性检查通过**。诊断修改保存在 [未应用补丁](diagnostic.patch.gz)，三个源码文件随后恢复为基线完整字节，指纹见 [恢复核对](restored-source-hashes.json)。

恢复后重新编译并执行原始严格原生检查：**15 项通过、2 项失败**，两项各 1155/307200 字节不同、最大差 7，输出/参考哈希与 alpha.37 完全相同。详见 [原生检查](restored-native-tests-summary.log)、[失败指纹](restored-failure-fingerprints.json)。Rust 格式与 `cargo check --locked --release -p cap-editor` 通过，见 [格式](fmt.log)、[原生编译](check.log)。没有将诊断探针计入产品测试通过数。

独立程序仅生成静默画面数据，未读取用户录制、连接物理设备或改变网络。应用效果、分辨率、曲线、模糊、音频和用户工程均保持 alpha.37。

## 复跑

在 macOS、完整 Xcode 和现有 `next/cap/target/native-deps` 可用时，从仓库根目录执行：

```sh
python3 next/verification/2026-10-27-decoder-parity/reproduce.py --output /tmp/jianku-decoder-parity-report.json
```

[驱动](reproduce.py)会解压两份本轮生成的合成媒体，使用内置 FFmpeg 编译 [C 读取器](ffmpeg-native.c)，编译 [AVFoundation 读取器](av-output.swift)，比较每轨 110 帧和原生/内存平面，记录库和输入指纹，最后自动删除工作目录。要求输出文件原先不存在。这个独立程序不需要修改产品源码或编译整个应用；不将上表差异量作为允许门限。重跑日志见 [记录](portable-reproduction.log)。

其他调用选项试验的源代码保存在 [补充探针归档](supplementary-probes.tar.gz)，保留当时的临时路径；标准复跑使用上面的驱动。

辅助 API 核对使用 Apple 的 [AVAssetReaderTrackOutput 文档](https://developer.apple.com/documentation/avfoundation/avassetreadertrackoutput)和 [FFmpeg 7.1.3 VideoToolbox 实现](https://github.com/FFmpeg/FFmpeg/blob/n7.1.3/libavcodec/videotoolbox.c)；数值结论来自上述本机运行，不由文档推断。

## 下一步

先继续核对 FFmpeg VideoToolbox 会话与样本调用，在代表性素材验证能保留画质与性能的方案；并推进 10/30/60 分钟复杂时间线的稳定性、音画同步和内存检查。随后按 [正式版发布计划](../../../docs/首个正式版发布计划.md)逐页完成中文及发布审计。设备/副屏/会议实机验收继续按用户要求顺延。

检查结束后已清理本轮中间对象和自制临时数据，实测可用空间增加约 0.29 GiB，当前约 73.6 GiB；当前/上一版应用、原生依赖和用户数据保留，见 [清理记录](cleanup.json)。
