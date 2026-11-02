# 3D轨道拖动：遗留监听与首个移动事件诊断

2026-11-02，源码基线0898322。当前安装54／回滚53，本轮只有诊断，没有产品修改、构建或窗口操作。

直接从ThreeDTrack的createMouseDownDrag提取原createRoot监听块和原update函数，在本机已有Chromium中运行，使用真实Solid客户端及event-listener包；几何更新／结束回调替换成计数器。update仅去掉MouseEvent类型标注，位移／阈值逻辑保持原样。源码SHA和范围见observed-defect.json，原片段一同保留。

两个独立场景触发window.blur、销毁外层Solid owner，随后mousemove仍各调用update一次，finish均为0；手动mouseup后才清理。另从clientX=200按下，首个mousemove到600，原update传给几何回调的位移为0，原因是将第一个移动位置作为新的起点。observed=true表示缺陷被观察到，不是修复通过。

本探针没有运行完整ThreeDTrack、实际历史／keyframe写入或视频预览，不能据此认定全部3D交互或画面闪屏根因。下一用真实组件验证并修复监听所有权、取消／历史和源片段身份，保留fitCamera3DMotionToSegment的关键帧适配及既有运动曲线，再做单移动事件和完整包验收。

复现：在next/cap执行`node ../verification/2026-11-02-three-d-diagnosis/probe.mjs`。脚本创建自己的临时目录，只作静态打包／headless浏览器检查，不启动服务器或下载浏览器。目录中的probe.log是实际成功执行记录。

上轮按键源码仍待入包；Zoom／Clip／Style／Image、滑块／分隔条、预览队列、原始录制单镜头、完整中文／审计、色度两项失败／硬件成片、Windows／Linux及延期实机继续保留。
