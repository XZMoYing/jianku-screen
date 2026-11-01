# 时间线拖动与悬停预览竞争

2026-11-01，U22c1，源码修复。安装仍 alpha.50，回滚 alpha.49；当前未打包或验收完整编辑器，不能据本项宣称全部拖动／视频闪屏已解决。

原 Timeline/index.tsx 的鼠标移动处理器在拖动时仍更新悬停时间，而片段边缘的 window.mousemove 处理器再写边缘时间。普通浏览器事件冒泡先经过父元素，后到窗口；拖出时间线还会清空 previewTime。保存的原始回调（hover-before.txt，源码哈希见 before.json）在真实 Chromium 事件分发、模拟被限制为4秒的片段边缘下得到 [6,4,null,4]。这确认了重复预览写入，没有把它当作完整视频闪屏的像素证明。

将原悬停计算抽成共享回调，并在已捕获时间线按下状态或鼠标仍有按键时，让悬停逻辑停止写入／清空预览。片段修剪和播放头拖动继续使用各自预览路径。普通悬停、起点吸附、越界清空、播放状态及松手恢复保持。

8项新增真实DOM事件回归及既有62项界面回归通过，共70项；完整桌面类型和前端构建通过。Chromium普通／减少动态效果与本机AppKit/WKWebView均运行真实产品回调，拖动序列为 [4,4]，松手后悬停为 [4,4,6]。它们模拟边缘时间，没有运行完整轨道修剪或安装版视频渲染；真实项目、保存／导出、所有滑块和拖动取消链路继续U22c。

恢复局部基线在开工前通过（原生检查、配置安全写入、遥测、41项前端及构建）；本项没有修改Rust、曲线、模糊或视觉质量，不重复编译相同原生代码。既有严格解码两项失败、硬件成片差异及完整中文／审计、Windows／Linux门槛保持。

复现：next/cap下执行 bun run --cwd apps/desktop vitest run --config vitest.interface.config.ts。浏览器合成页先执行 bun build ../verification/2026-11-01-timeline-hover/fixture.ts --target browser --format iife --outfile /private/tmp/jianku-u22c/fixture.js，再执行 node ../verification/2026-11-01-timeline-hover/verify-browser.mjs，并用JIANKU_BROWSER_PATH指定已有Chromium。先创建该临时目录。WK工具传入生成的fixture.html，必须检查JSON passed。

下一继续U22c2：各轨道移动／修剪的排序后索引、取消与历史恢复、其他画布控件及完整阶段包；随后U23对照Cap事件和自动镜头生成。原Cap比较与自动缩放仅一段尚未处理。
