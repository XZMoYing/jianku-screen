# 角点缩放与原生布局对齐

2026-11-01，U22b。完成源码和隔离交互验证；当前安装仍 alpha.50，回滚 alpha.49，尚未生成本批完整安装包。U22 的全部拖动／视频闪屏问题未关闭，U23 自动镜头生成尚未处理。

## 原因及修正

原角点公式从当前操作框比例估算留白，不能同时表达裁剪、外框、内边距、固定比例和输出取整。现在复用截图布局计算，并补齐原生 f32 输出取整、外卡片和样式固定画布映射，用同一布局反求留白和显示操作框。源尺寸从当前时间对应的录制片段读取，包含片段过渡及停帧时间映射；松手后等待匹配几何，再接纳后续布局。更换设置、清晰度、时间或上下文会解除等待。

另外，固定比例的原生适配轴以前比较完整输出比例，却把扣除留白的区域用于尺寸计算，可能超出可用区，并在输出比例取整变化时出现尺寸突变。现在原生与前端均按扣除留白后的可用区选择适配轴。连续取样 3 个源比例、2 种固定比例、每种 7001 个留白位置（42,006 组），检查可用边界和相邻尺寸变化。

这会修正部分原先过大的固定比例卡片，并非所有像素尺寸保持原样。native-comparison.json 保存之前和当前的真实原生数据对照，各组 189 条中 21 条外卡片宽度改变超过 1 像素。没有降低预览或导出质量，没有移除阴影、内边距、动态模糊，也没有修改光标／缩放／3D 运镜曲线。

截图布局中的浏览器顶部高度还沿用旧值 0.075，已对齐原生当前 0.062，并重新导出截图内容几何基准；保留原截图注释重映射接口及回归。

## 验证

- 756 条原生布局逐项核对输出取整及外卡片；另 756 条固定画布样式核对原生 styled_display_layout。包括 3 个源尺寸、裁剪、适合屏幕／宽屏／方形、7 种外框、3 种内边距和 4 个留白值。四组压缩 JSON 可复核，不是人工编造期望。
- 5 项反求／布局检查、13 项布局确认、3 项截图回归，及 62 项界面检查通过。画布交互共 13 项，另验证跨片段切换后的源尺寸选择；新增自动比例和宽屏下带浏览器外框／内边距的实时尺寸、旧布局与最终确认路径。反求还检查非整数 37.413 留白对应目标，在一个输出像素内；操作框直接使用最终参数的精确布局，没有扩大确认容差。
- Chromium 22 项通过，普通／减少动态效果均包含重复真实鼠标移动、边缘中心和带外框／内边距缩放。主观动效和完整编辑器不据此标为通过。静态页面只替代上下文和翻译，使用真实 CanvasElementsOverlay，不启动服务器。
- 本机 AppKit/WKWebView 同一组件页面通过，webkit-final.json 的 passed=true；新增带外框／内边距的缩放中、松手后旧布局和最终确认检查。不是 Playwright WebKit，也不是已安装完整应用验收。
- 9 项相关原生／GPU 回归通过；另 5 项既有比例与 1 项样式连续性检查通过。相关覆盖包括内边距像素与实时输出一致、动态模糊枢轴稳定、缩放／3D 跳转逐帧一致及标记跟踪。cargo fmt、cap-rendering release check、完整桌面 TypeScript、前端构建和作用域 Biome 均通过。
- 浏览器额外观察每种动态设置下 1000 次反求耗时，原始数值在 browser.log.gz；该数字只是本机合成计算耗时，不是完整编辑器帧率验收或低配承诺。

第一次误从仓库根目录运行 Vitest，路径别名无法解析且没有执行测试；已改为 apps/desktop 的现有入口，实际 21 项全通过。不把错误入口当作通过。恢复局部基线本轮开工前已通过，既有严格解码两项失败不属于该局部基线。

## 复现

在 next/cap 执行 bun run --cwd apps/desktop vitest run src/routes/editor/display-resize.test.ts src/routes/editor/canvas-layout.test.ts src/routes/screenshot-editor/layout.test.ts，以及 bun run --cwd apps/desktop vitest run --config vitest.interface.config.ts。

原生：cargo test --locked --release -p cap-rendering --lib display_resize_layouts_fit_padding_and_remain_continuous。另 inset_ 过滤器执行本批相关 9 项。macOS 需沿用 target/native-deps/lib 和 target/native-deps/onnxruntime/lib 的 DYLD_LIBRARY_PATH。原生布局测试 inset_layouts_preserve_aspect_and_generate_screenshot_geometry 可通过 JIANKU_LAYOUT_PADDING=10/20/40/70 和 JIANKU_INSET_LAYOUT_OUTPUT 导出四组 JSON（含 styledOuter）。

在本目录执行 node verify-browser.mjs，JIANKU_BROWSER_PATH 可指向现有 Chromium。生成 fixture.html、webkit-fixture.html 和 results.json 到系统临时目录。WKWebView 辅助程序仍复用上一项记录的工具源代码；必须检查 JSON passed，而非仅看进程退出状态。

## 继续保留

时间线、字幕／遮罩／图像框、滑块、分隔条、混合样式和完整原生编辑器的用户场景仍继续 U22c；组件通过不能证明所有视频闪屏／无法拖动已修复。U23 下一对照 Cap 采集事件和镜头生成，不改已有舒适曲线。完整中文／审计、严格色度 15 通过／2 失败、硬件成片运行差异、Windows／Linux 和延期实机门槛保持。
