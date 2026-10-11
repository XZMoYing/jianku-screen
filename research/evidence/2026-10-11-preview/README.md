# 0.1.5 编辑预览性能验证

日期：2026-10-11。Apple M1 MacBook Air，8 核、16 GiB；macOS 14.7.4、Qt 6.11.2。测试构建为 Release + BUILD_TESTING，实际试用包为不含验证入口的 Release。基线为本轮优化前 0.1.4 的同一实现，仅增加测量接口。

| 相同 3360×2100 素材、同一 960×540 预览 | 优化前（60 fps 源） | 优化后（60 fps 源） | 优化后（30 fps 源） |
| --- | --- | --- | --- |
| 8 秒内有效合成更新/秒，包含起播 | 0.50 | 57.10 | 58.22 |
| 起播 1 秒后的有效更新/秒 | 未采集 | 59.66 | 59.96 |
| 播放时精确定位次数 | 14 | 0 | 0 |
| 界面 8 ms 心跳的 P95 间隔 | 9.02 ms | 10.26 ms | 8.98 ms |

有效更新按实际交付的新媒体时刻统计，不以定时器调用次数冒充帧率；解码帧数单独记录（60 fps 源 463，30 fps 源 234）。序列包含四段运镜、连续光标移动、旋转和点击；保留阴影、圆角、背景与动态模糊。分辨率、采样核和强度未下调。此表只代表本机短素材，不是对所有机器/工程的帧率承诺。

- baseline-ui-result.json：隔离基线运行，14 次反复定位、约 0.5 次/秒更新。墙钟跑在媒体定位前方是本轮定位的卡顿原因。
- preview-60-result.json、preview-30-result.json：原生窗口实测，均通过显式验收门限（有效更新 ≥50 fps、交付间隔 P95 ≤40 ms、界面心跳 P95 ≤24 ms）。60 fps 用例还覆盖真实播放的重排/2×变速/连续源段、末尾重播、连续三次定位；重排切点仅一次定位，连续变速无需定位。
- identity-size-result.json：原始帧恰为 960×540，覆盖缩放不改变尺寸时必须取得自有像素存储的情况；播放、变速/重排、末尾重播和快速定位通过，避免 CV 缓冲释放后的悬空缓存。
- render-baseline/：优化前九张完整合成帧；preview-render 回归默认读取并逐像素比较。包含原始/正方形/裁切、阴影/圆角/指针和两种模糊。render-baseline.json 与 render-optimized.json 记录相同完整合成工作负载的耗时；不以这些固定姿态替代实际播放测试。
- ctest.log：19/19 通过。MotionBlurTests 用保留的旧双精度累积算法检验透明、小数/负向位移、画布外中心、不同核及并发结果；舍入与采样结果必须完全相同。
- focus-ui-result.json、crop-ui-result.json：原生界面中的焦点目标构图/位置面板/画布定位、裁切手势/像素确认/取消/撤销及实际 Metal 取样通过。焦点像素检查等待后台实际新帧，保留坐标变化及像素变化两个断言。
- real-record-copy-result.json：用户真实录制的隔离副本通过首帧、播放、快速定位、外观及编辑保存；不收录该副本画面或媒体。
- package.log、signature.txt、native-window-check.json：独立依赖、稳定签名、DMG 与实际窗口。脚本中 offscreen 的 Abort trap 是预期依赖检查，仅验证加载来源；实际 Cocoa 窗口另外验证。

复现：用 tests/create_preview_fixture.py 在新目录生成素材，运行测试版应用：

```sh
python3 tests/create_preview_fixture.py /tmp/preview-check/sample.jianku
"build-performance/Jianku Screen.app/Contents/MacOS/Jianku Screen" --verify-editor /tmp/preview-check/sample.jianku --verification-output /tmp/preview-check/result --verify-performance --verify-playback --require-smooth-preview
```

30 fps 使用 --rate 30；不缩小原图尺寸的缓存用例使用 --size 960x540。需要 PATH 中有 ffmpeg。性能前后比较应在无构建/编码任务的相同状态下顺序执行，保留原数据，不对不同条件的数字作归因。

实现采用 AVPlayer 媒体时钟、Qt 工作池与场景图显示。纹理替换的生命周期按 [Qt 6.11 原实现](https://github.com/qt/qtdeclarative/blob/6.11/src/quick/scenegraph/util/qsgsimpletexturenode.cpp) 核对；OwnsTexture 已由 setTexture 释放旧纹理。

实际打开版本 0.1.5，PID 32927，应用 build-release/试用/0.1.5/Jianku Screen.app；工程 ~/Movies/Jianku Screen/试用 0.1.5/连续运镜试用.jianku（合成 30 fps 素材，静音）。另保留原录制编辑试用.jianku 副本。未主动结束旧版进程或覆盖其工程。安装包为 build-release/简库镜传 2026.10.11.4.dmg。

动画与固定参考的百分之百一致、原生采集权限/结束闭环、多屏会议、长素材、独立麦克风、HDR/色彩和所有显示路径仍待验收，统一见 docs/待验证项目交接.md。
