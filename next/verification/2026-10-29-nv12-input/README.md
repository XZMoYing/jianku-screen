# U19d2a：NV12 交接与既有硬件导出差异定位

本轮完成诊断与证据归档，未关闭导出稳定性门槛，未交付 alpha.46。安装应用仍为 alpha.45；诊断改动已按原始 SHA 逐字节还原，原生 CLI 重新构建情况见 restored-cli-build-result.json。摄像头阴影组件的 354 项库检查属于[上一阶段](../2026-10-29-camera-shadow/README.md)，本轮没有重写该组件或用旧测试冒充新修复。

## 已确认的事实

| 验证 | 观察 |
| --- | --- |
| 当前组件 CLI，12 次各 540 帧 | 全部 6480 帧的 producer/consumer 可见 Y、UV SHA 一致；各次原始输入也一致。两次 MP4 从 365、437 帧起分别有 175、103 帧不同。 |
| 未修改的已安装 alpha.45，12 次 | 一次从 222 帧起有 318 帧不同，其余与正常基线相同；没有注入探针。因此问题早于本轮摄像头阴影改动。 |
| 旧 45 与新组件的实际 GPU NV12 输入 | 各 540 帧、746496000 字节，整个流 SHA 完全相同：40c2c993c13cc71650085efc405fe46874efb6a08d7b402267d273db8ed2dabc。 |
| 精确输入重放 | 用上述实际原始流、同一套原生 FFmpeg 库和对应码率，540 个独立 IOSurface 全程持有；12 次均与正常成片逐帧一致。4 种停顿/突发节奏也一致，编码结束后再次核对全部输入字节未被改动。 |
| 只复制编码器入口的 NV12 像素 | 12 次均与正常成片相同，入口哈希也相同；这是独立缓冲区诊断，不是产品性能方案，也不能仅凭 12 次未复现宣布解决。 |
| 只给原缓冲区补 BT.709 matrix/primaries/transfer | 24 次中的第 7 次仍有 431 帧不同；该假设不成立，未据此修改产品。 |

正常背景角像素为 RGB 238/234/223；异常样本为 236/232/224，与首次 297 帧异常的现象相符。差异已出现在 H.264 包中，不是仅由播放器解码造成。最初[严格失败记录](../2026-10-29-camera-shadow/comparison-violations.json)及本轮全部失败均保留，没有放宽像素阈值。像素与元数据实验只针对自制彩条/测试摄像头工程，没有采集真实桌面或设备内容。

这组证据排除了“本次关闭阴影路径改变了该样本原始画面”的解释，并把调查重点缩小到真实 GPU IOSurface 到异步 VideoToolbox 读取的路径。**仍未证明是提前复用、同步/缓存、驱动处理或其他硬件编码行为；不将未复现视为根因已经查明。** 原先 ProRes 转 NV12 的探索流与 GPU 输入并不相同，fixed/paced 报告只作辅助；核心结论使用 captured-input-validation.json 验证过的精确原始流。

本机原生 libavcodec 61.19.100、libavformat 61.7.100、libavutil 59.39.100 与安装 45 随包库的 SHA 一致，见 native-libraries.json。静态检查还核对了 [FFmpeg n7.1 的输入引用与回调代码](https://github.com/FFmpeg/FFmpeg/blob/n7.1/libavcodec/videotoolboxenc.c#L2274)：其硬件输入分支保留 CVPixelBuffer 和 AVBufferRef，回调释放引用；这不能替代实际生命周期/硬件读取验证。

## 复现资料

- summary.json 为结果索引；各 comparison.json 保留每次差异的准确帧号。
- trace/ 下 98 个 gzip 保存 producer/consumer 原始 JSONL，仅含帧号、尺寸、匿名缓冲区编号、Y/UV 哈希，不保存地址或像素。trace-manifest.json 核对解压前后 SHA。
- probe/temporary-probe.patch.gz 解压后是已撤销的临时 Rust 探针（manifest 中的补丁 SHA 按解压原文核对），配套 run-probe.py、old-repeat.py 和 C 原生诊断源码；**不属于产品补丁，不用于最终应用**。固定输入程序将所有独立缓冲区保持到编码 flush 后，再逐字节检查输入；颜色标记/像素复制库仅通过单个合成 CLI 子进程的 DYLD_INSERT_LIBRARIES 使用。
- persistent-input-fixtures.json 指向 Builds/摄像头透视阴影对照/NV12交接诊断：保留正常片、三类真实异常、精确输入重放/复制对照，以及已压缩原始流。8 个持久文件逐个 SHA 核对；原始流 zstd 解压后再次核对 SHA。十个完整 .jks 工程仍在上一目录的持久清单中。
- 原始执行脚本记录当时的临时路径，复跑时用新的空目录，并从持久清单选择 camera-shadow-off.jks；不能覆盖现有报告。先解压 gpu-input.nv12.zst 到新的工作目录，再运行 exact-surface 原生程序。第一次 CLI 命令误选了 package cap-cli，离线缺失 bindgen；实际本产品 package 是 cap，改为 cargo build --offline --release -p cap 后成功。原始失败日志没有删除。

原生小程序使用本仓库 target/native-deps/include、lib，编译参数为 C11/Wall/Wextra/Werror，链接 avcodec/avformat/avutil 与 CoreVideo/CoreFoundation。运行时仅为该子进程设置 DYLD_LIBRARY_PATH，避免系统 Python 启动时被 SIP 清理；不要全局注入诊断库。临时 Rust 探针会增加 CPU 只读锁和哈希开销，可能改变时序，不能把探针中的成功当作正常运行稳定性保证。

## 还原、存储与界面

三份产品文件 mp4.rs、export/Cargo.toml、Cargo.lock 的原始 SHA 与 HEAD 内容相符，撤销后逐字节相符；release check、fmt 和干净 CLI 构建记录另存。正式包不能复用诊断 CLI；本轮重新构建未带探针的原生 CLI。没有修改生成绑定、权限、网络或用户素材。

已压缩保存精确输入，只清理本轮临时目录中的 109 个自制可再生视频/裸流，逻辑约 2.99 GiB；实际 APFS 空间变化见 cleanup.json，不把逻辑大小当作实际腾出空间。所有异常样本、完整工程、当前 45/回滚 44 和原生构建缓存保留。

用户结束体验后，正常退出旧进程 74948 并重新打开安装 45 的自制示例，未强退。CG 能看到新编辑器，但 AX 仍只列泛用主窗口节点；按标题、再按唯一窗口几何匹配均未获得可确认的编辑器节点，工具保持拒绝操作。U19c2 的播放/暂停/回零/退出全屏交互仍待，不能把 AX 工具失败当作产品行为或验收通过。

下一项 U19d2b：核对表面复用、GPU 写入完成与异步编码读取/释放，保留无像素复制的产品性能；初始异常与严格解码色度门槛仍在。完整中文/本土化、内部审计、Windows/Linux 适配及目标平台验证的目标没有缩小。
