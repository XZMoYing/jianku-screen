# DogSC 源码复用

来源：[DogSC 仓库](https://github.com/laogou717/dogsc)
锁定提交：fa24059a9ba7e769152b3c1de047d96aca873e1c
许可证：MIT，原文见 LICENSE。

EditorTimelineMagneticSnap.swift 原样保存用于核对；src/render/TimelineMagnet.h 将其手势局部吸附算法迁移到 C++：7 点捕获、14 点释放、初始边界抑制、Shift 临时旁路、缓存候选与二分邻点查找。时间单位从秒转换为毫秒，UI 事件和可观察状态由 Qt 提供。

该源码依赖 SwiftUI/AppKit，不能直接作为 Qt Quick 控件使用；保留算法与许可，迁移交互层，以维持 Windows 后续适配路径。未采用原项目的画面、缩放、指针平滑、旋转或点击动效求解器。


第二项算法复用：`TimelineMap.swift` 原样保存；`src/project/FocusTrack.h` 使用其 `outputStart + (sourceTime - sourceStart) / playbackRate` 公式，按保留片段求交并分别输出焦点区间。时间单位由秒转换为毫秒，返回 Qt/本项目结构，允许本项目已有的主片段重排；不复制 DogSC 的光标插值或镜头求解器。原文件来自 `Sources/RecorderCore/TimelineMap.swift`，与上述锁定提交一致。

第三项算法复用：`NormalizedCrop.swift` 保存 `Sources/RecorderCore/ProjectModel.swift` 第 760–811 行的原始结构；`CropGestures.swift` 保存 `Sources/DogSCApp/EditorCanvasPreview.swift` 第 748–815 行的原始移动、八个边缘/角点缩放方法。`src/render/SourceCrop.h` 将归一化裁切、移动边界和对边锚定迁移到 C++，保留 2% 尺寸下限及拖动时的 24 源像素下限；增加非有限值/类型校验。`CropController` 将选框边缘对齐到原始像素，维护确认/取消草稿，使用本项目统一历史。原始片段与上述提交一致，适用同一 MIT 许可。

裁切工作流参考 `EditorCropPresentation.swift` 与 `EditorViewCropAndPreset.swift`：暂停、独立草稿、复位、确认和取消。Qt 界面与源坐标/画布坐标映射由本项目实现；采集不裁掉原始录制，预览、导出和截图按同一归一化范围取样。既有弹簧、光标姿态与点击反馈未替换。

编辑器迁移依据（界面与工作流参考，相关 Qt 实现见功能台账）：

- `EditorTimelinePrimaryEditing.swift`：主片段分割、裁剪、重排、变速与剪切恢复。
- `EditorTimelineFilmstrip.swift`、`EditorTimelineWaveformCache.swift`、`EditorTimelineZoomTransport.swift`：可见区域媒体请求、波形缓存和时间线浏览。
- `EditorTimelineMotionEditing.swift`、`EditorTimelineOverlayTracks.swift`：效果轨道区间创建、选择、移动、缩放和相邻吸附。
- `EditorInspectorView.swift`、`EditorInspectorScopeControls.swift`：检查器随选择切换、全片/片段声音继承、播放头与当前选择分别处理。
- `EditorOverlayInspector.swift`：柔化/突出、贴图图层排序、入场/退场、背景及摄像头显隐。
- `EditorFocusEffectInspector.swift`：线性/径向聚焦柔化及位置/方向/跟随目标。
- `EditorInspectorTransactions.swift`、`EditorInspectorCommands.swift`：跨控件历史事务和复制/属性粘贴。

上述 SwiftUI/AppKit 组件未作为可执行模块整块引入。磁吸和 TimelineMap 映射公式的迁移分别记账；焦点轨道、检查器、历史和剪贴板由 Qt 接口实现。具体待实施功能见 `docs/编辑器完整功能对齐.md`。
