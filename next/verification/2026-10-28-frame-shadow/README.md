# U19：浏览器外框与3D透视阴影

用户指出浏览器外框陈旧、3D时画面缺少正面已有的舒适阴影。当前安装alpha.44；U19a/b组件和真实导出已验证，alpha.45完整打包/界面对照仍待U19c，不能把源码改动说成当前已运行。

## U19a 轻薄浏览器工具栏

共用frame_chrome::browser_svg换成中性浅/深色、较小控制点与细线导航、紧凑居中网址/站点设置图标，降低工具栏高度，窄画面隐藏导航并限制网址绘制区，保留用户网址原值与现有样机选择。文字XML转义和现有2倍超采样/纹理缓存保留，不改缩放或运镜曲线。只调整Browser，其他外框不改配色。原Palette的三个不再使用字段删除。

cargo fmt、最终cap-rendering release check通过；frame_chrome四项回归通过、一个手工图片导出helper忽略。首次测试启动因在SIP系统zsh之后设置DYLD导致环境被剥离，日志保留；直接给cargo传入既有原生库路径后通过，未更改系统设置或清理依赖。四张PNG用与产品一致的resvg生成（浅/深/窄/中文），函数与组件相同，画面合成/完整导出将在后续核对。QuickLook方形缩略会裁切长条SVG，未将其误当作组件排版。

## 参考与修改前素材

当前DogSC官方源码固定567fd6ed3bf113227dcf3e815f87ce60f0b69497，来源https://github.com/laogou717/dogsc/tree/567fd6ed3bf113227dcf3e815f87ce60f0b69497 ，相关源文件及MIT许可在reference/。其SharedFrameRenderer在透视投影后以alpha轮廓生成阴影；ScreenFrameDefaults为不同样机提供独立参数。借鉴结构与布局依据，渲染实现保持本项目WGPU路线。

修改前alpha.43随包CLI已完成六组自制合成工程的真实GPU完整导出：浅/深浏览器正面、普通/内框100运动、macOS正面、关闭阴影的3D运动。各1280×720/60fps/540帧、原配置SHA未改，见before-exports.json、before-media.json。视频保存在Jianku Screen Next Builds/外框与透视阴影对照/修改前；独立带标记APFS克隆工程/源示例保留。普通展示仅移除压力内框，不能把它叫做软件新录制默认值。用户已明确理解内框100的压力用途，不删除该用例。夹具来源是已有自制工程，不使用用户画面。

## U19b 投影轮廓阴影与验证

rendering/src/lib.rs的camera3d_shadow_fade=1-activity会主动消除阴影。圆角、内框和外框仍在统一content group，warp后再叠加平面标注；阴影需要从独立无旧平面阴影的alpha轮廓经同一投影后生成，避免把已烘焙的平面阴影当物体一起变形或裁切。需要保留advancedShadow大小/不透明度/柔化与进出3D的连续性，检查仅虚化无透视的情况。普通2D/关闭阴影/非Browser样机回归不能放宽阈值，预览与导出同一GPU路径。摄像头独立阴影和MacBook自带SVG阴影的边界须核对，不能把整组光标/摄像头简单当成屏幕阴影蒙版。

后续追加真实GPU像素/成片及完整包证据再关闭U19。现有两个严格解码色度失败、物理验收、汉化/审计和目标平台仍待办。


2026-10-28 U19b：复用现有Composite几何/纹理/圆角/内框，使用延迟创建的alpha-only蒙版入口消除原平面阴影，再由相同Camera3D投影和13次曝光采样生成轮廓，扩散、分离高斯后合成到背景。不包括光标和摄像头，避免把两者误当成主画面投影。正常fs_main保留同一色彩计算；两张纹理、两组绑定及pipeline按尺寸复用。仅虚化无透视时保持平面阴影；3D进出增益补偿原strength/opacity双衰减，从实际未衰减Composite参数继承高级阴影、旧fallback与Split/文字接管可见性，多个owner连续混合。

最终检查：cargo fmt/check、完整cap-rendering库353通过/6忽略、严格Clippy及本地CLI构建通过，见shadow-checks.json和压缩日志。真实GPU检查投影新增中性背景阴影、不透明视频前景逐像素不变、预览/导出RGBA相同、阴影关闭无附加通道、仅虚化仍有阴影。初始新测试的暖色亚像素边缘判断错误及测试闭包类型失败日志保留，修正测试范围/类型后通过；未放宽既有严格解码回归。

真实完整导出：六组1280×720/60fps/540帧。Browser四组变化属于预期；普通macOS和关闭阴影的3D两组各540帧完全相同；所有PCM相同。旧工程advancedShadow缺失与显式50/18/50在修正前原型435/540帧不同，修正后540帧及PCM全同（legacy-before-comparison.json、after-comparison.json）。该原型没有交付，不能误称alpha.43存在此新回归。成片联系表已实际查看，浅/深工具栏、普通/压力内框在倾斜后保持形状与投影阴影。导出耗时仅观察值，不代表GUI显示帧率。

边界：MacBook自带SVG阴影仍保留；CameraOnly原背景阴影保持。浮动摄像头的自身阴影仍走原camera3d衰减，属于独立后续项，本次不将其混入屏幕投影。尚未完成45整包与实际UI验收，不关闭U19父项；原有严格色度失败及跨平台/物理验收仍保留。
