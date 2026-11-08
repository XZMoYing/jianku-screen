# 主轨转场工程加载/导出（alpha.108，U25b 部分）

夹具：复验工程改造为主轨 A（0–4）/ B（4–8，同源 recordingSegment 0），timeline.transitions=[{segmentIndex:1,type:cross-fade,duration:0.5}]。

## 结果

- 导出：转场开启 225 帧/7.5s（导出成功），转场关闭 240 帧/8.0s；开启 cross-fade 后时长缩短 0.5s，与重叠一致。
- 因两段引用同源画面，边界帧差仅 0.008–0.009，**无法从像素判断交叉淡化观感**。
- UI：编辑器加载成功（338 AX 节点），主轨显示 A/B 两段，打开后配置保留 segments 与 transitions（cross-fade 0.5）。

## 结论

转场工程可加载、配置保留、导出成功且时长按转场重叠缩短；U25b「真实工程转场组合」部分验证。不同源画面视觉交叉、转场+字幕/变速/空隙叠加映射、UI 增删转场、其它转场类型仍待。

## 证据

- transition-summary.json；transition-on.mp4 / transition-off.mp4；transition-ui.json；导出与 UI 日志。
