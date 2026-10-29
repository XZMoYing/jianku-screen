# U19d2b1：编码释放边界与 IOSurface 发布验证

本轮是对两个具体假设的验证，没有形成有效产品修复；导出稳定性仍未通过，应用保持 alpha.45。产品源码及干净 CLI 与上轮相同，没有加入像素复制、等待时间常数或关闭效果的变更。上一轮原始输入证据见 [NV12 交接诊断](../2026-10-29-nv12-input/README.md)。

## 释放边界

临时原生探针传入相同 CVPixelBuffer，用新 AVBufferRef 包装并持有原 AVBufferRef；仍由 FFmpeg 的异步编码回调控制最后释放。送入前与包装引用最后释放时分别读取可见 Y/UV，记录 SHA，不复制或保存像素。12 次各 540 帧，共 6480 个释放回调全部到达，帧号完整，原始像素与正常基线一致，释放时也未发现变化。

第 6 次导出仍从第 209 帧起有 331 帧不同。因此这些观测不支持普通的“输入在编码期间被提前覆写”解释；没有据此延长全部缓冲区生命期或增加无界内存保留。前后两次取样不是连续内存监测，不能证明中间绝不存在改写后恢复，也不能替代 VideoToolbox 内部读取的观测。CPU 只读锁和哈希会影响时序，探针不是正式运行的性能测量。

## 发布标记

第二个探针在已由 GPU 完成的同一个 IOSurface 上执行写锁/解锁，确认其 seed 更新；操作前后再次读取可见 Y/UV 哈希。24 次共 12960 个送入点，seed 全部更新、像素均未改变，输入也与正常基线一致。第 2 次仍从第 191 帧起有 349 帧不同。这条缓存标记假设同样未形成修复，未加入产品。

publish-comparison.json 沿用执行脚本中的 callbacks 字段表示采样行数；该组实际是同步送入点，不是异步释放回调。summary.json 用 publishedSeeds 单独计数。两组异常与正常日志在忽略指针格式后未出现额外警告，不能据没有日志推断驱动内部正常。

[Chromium 的实现](https://chromium.googlesource.com/experimental/chromium/src/+/4863ce7e2ffd140f7765530e45d67903fd964a69/gpu/command_buffer/service/shared_image/iosurface_image_backing.mm#1580) 提供了用锁/解锁通知其他消费者内容更新的实例；该处语境是 iOS 的 CPU 写入，并不证明本项目的 Metal/VideoToolbox 路径需要此办法。本轮用真实导出验证后未采纳。

本机 Xcode 16.2 的 Metal SDK 还说明，纹理压缩默认无损，启用有损压缩需要 Private 存储模式。当前 IOSurface 纹理创建代码使用 Shared，未发现主动启用有损压缩的设置；这仅是源码/SDK 合约检查，不是对驱动实现的保证。未据未经验证的推测关闭纹理优化。

## 数据与复跑

summary.json 与两份 comparison.json 保存准确帧号；36 份 gzip 保存 19440 条送入/释放纯哈希记录和 seed 数值，trace-manifest.json 核对 SHA。probe/ 下为实际执行的 C 和 Python 源码，仅在自制 camera-shadow-off.jks 工程的 CLI 子进程中通过 DYLD_INSERT_LIBRARIES 使用。没有操作应用、真实桌面、设备、网络或系统权限；诊断库没有进入产品。

原生诊断库使用 C11、Wall/Wextra/Werror 编译，链接本仓库 target/native-deps 中的 avcodec/avutil，以及 CoreVideo（发布探针另需 IOSurface）。在新的空临时目录编译后修改脚本中的诊断目录，直接使用上一阶段持久工程清单和持久正常成片；脚本中的报告存在检查用于防止覆盖原证据。两个探针均使用当前未修改 CLI，指纹见 source-manifest.json。

三份正常/异常对照保存到 Builds/摄像头透视阴影对照/NV12交接诊断/释放时序，并逐文件核对 SHA，见 persistent-samples.json。只清理本轮临时目录内 36 个可再生测试视频，逻辑约 426.5 MiB；原始异常片、完整工程和既有压缩原始流继续保留。逻辑大小不是实际 APFS 回收量。

## 后续与独立发现

U19d2/U19d2b 仍未解决。两个明确候选都已失败，继续保留该项为发布门槛，后续在 U11 审计中结合硬件编码行为处理；不能把本轮验证完成写成修复完成。下一轮推进不依赖该问题的 U06 中文/本土化逐页台账，再修复实际遗漏，完整候选版与 Windows/Linux 目标仍保持。

源代码审查另外发现 GPU rgba_to_nv12.wgsl 使用 BT.601 范围的数值系数，而硬件编码器上下文标为 BT.709/有限范围。它是独立的色彩契约核验项，须用标准色块对比预览 RGBA、GPU/CPU NV12 和最终编码后的实际输出，不能把这一静态疑点当作运行间偶发差异的根因。文件指纹已记录，未在本轮顺手改公式或测试基线。
