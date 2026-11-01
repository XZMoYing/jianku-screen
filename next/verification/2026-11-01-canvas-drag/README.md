# 预览画面移动：松手后旧布局回跳

2026-11-01，U22a。仅源码修复及隔离组件验证；当前安装仍为 alpha.50，回滚 alpha.49。本项不是全部编辑器拖动故障修复，未替换用户正在使用的应用或工程。

## 已确认并修正

真实 CanvasElementsOverlay 组件在浏览器中拖动、松手后，较早的渲染布局到达，原逻辑会立即清除临时位置。第一次对照中，操作框从 139.167/69.1667 回到 95.8333/50，再回到最终位置；前后记录分别在 canvas-before.json 和 canvas-after.json。它证明了操作框的位置回跳，不足以解释用户所有视频闪屏。

移动画面或摄像头后，操作框现在等待匹配最终位置的布局，容许一个输出像素的浮点舍入；独立确认两种元素。设置变化会解除等待，切换时间、样式或播放状态会结束拖动并清除临时状态，避免后续鼠标事件写入旧上下文。重复拖动沿用上次指针位置。未更改采集、视频像素、缩放曲线、阴影或动态模糊。

另外，画面允许中心移到边缘、部分超出画布，但角点缩放曾把临时操作框强制夹回画布内部。已移除该处不一致的夹取，保留渲染器使用的中心；摄像头完整留在画布内的规则保持。

## 验证和边界

- 13 项布局确认检查、10 项真实画布组件鼠标交互回归及原 49 项界面检查通过，共 72 项。覆盖旧/最终布局、连续拖动、摄像头移动、边缘缩放、设置修改、时间/样式/播放切换、失焦和卸载时清理及历史恢复。
- Chromium 静态合成页面使用真实产品组件，普通/减少动态效果各 8 项，共 16 项通过；其中包含三次真实鼠标拖动、旧布局/最终布局确认和边缘缩放中心。CSS 仅提供定位/命中布局，未复现整个编辑器视觉皮肤，不能据此验收全套动效。
- 本机 AppKit/WKWebView 隔离合成页面复测：137/76 在旧布局返回时保持，最终确认后能继续更新到 82/46，边缘缩放仍保持中心 80/225。webkit-final.json 的 passed=true；并非 Playwright WebKit，也不是已安装应用的完整编辑器验收。
- 完整 TypeScript、前端构建、作用域 Biome、cargo fmt 和 cap-rendering release check 通过。原生几何测试首次运行缺少本机 FFmpeg 动态库搜索路径，失败保留在 native-layout-test.log.gz；按项目已有 native-deps 路径重跑，四次各 189 条布局检查通过。不把首次失败隐藏为通过。

真实编辑器多处滑块、轨道拖动、无法拖动和视频闪屏尚未全部复现或修复，保留 U22。U23 自动镜头生成尚未开始，本项未比较或改动 Cap 的生成逻辑。用户实机、导出色度/硬件差异、全部中文/审计及 Windows/Linux 仍保持原门槛。

## 原生对照否定的候选方案

复核时尝试按素材裁剪比例及当前卡片宽度校准角点缩放，直接对照原生渲染器在 padding 10/20/40/70 的数据。相对于 padding 20 的 567 组对照中，69 组超过一个输出像素，最大宽度差约 158.33 像素；该方案已撤下，没有进入产品。报告是拒绝候选方案的诊断结果，不是 567 项验收通过。

因此本批的位置等待只应用于移动；缩放操作仍接纳渲染器返回的尺寸，不因预测尺寸不同而永久卡住操作框。复杂外框、内边距与固定比例下的缩放尺寸映射继续 U22b，必须先对齐真实渲染布局，不能仅增大容差或依赖超时掩盖。固定比例基础尺寸的 f32/f64 比较、输出取整、约束轴选择及 padding 限制都需要下一项逐步核对，目前没有据此修改渲染画面。

原生测试增加可选 JIANKU_LAYOUT_PADDING 及外卡片尺寸输出，仅用于测试；默认仍为 20，产品渲染器没有改动。native-layout-*.json.gz 为四组原始数据，rejected-resize-calibration.json 记录候选公式、拒绝统计和例子。

## 复现入口

从此目录执行 node verify-browser.mjs，可用 JIANKU_BROWSER_PATH 指定现有 Chromium；不启动开发服务器或下载浏览器。输出 fixture.html、webkit-fixture.html 和 results.json 到系统临时目录。fixtures 仅替代编辑器原生上下文/翻译，画布组件和拖动逻辑直接来自产品源码。

本机 WebKit 工具源代码复用上一项的 ../2026-11-01-mobile-scroll/wk-probe.swift，将窗口名改为拖动回归后编译，传入 webkit-fixture.html；结果必须另检查 passed，不以进程退出码代替结果。该辅助窗口无持久账户状态，不访问真实素材。

在 next/cap 下运行 cargo test --locked --release -p cap-rendering --lib inset_layouts_preserve_aspect_and_generate_screenshot_geometry，并设置 JIANKU_LAYOUT_PADDING 和 JIANKU_INSET_LAYOUT_OUTPUT 可导出原生布局。macOS 测试还需沿用项目 target/native-deps/lib 与 target/native-deps/onnxruntime/lib 的 DYLD_LIBRARY_PATH。source-validation.json 记录本批源码和检查文件的 SHA-256，所有压缩日志保留原始结论。
