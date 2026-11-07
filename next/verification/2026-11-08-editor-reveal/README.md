# 编辑器窗口冷启动白屏修复：原生背板 → 首帧后显示（alpha.95/96）

## 背景

第 32 轮实测 alpha.94 冷启动打开工程时，编辑器窗口先以纯白显示约 0.6 s（首帧像素 253,253,253）再绘制 UI，与用户「初期闪屏」相符；新增 U22c2b9b4a。

## 修复过程与实测

1. **alpha.95（815c85d）**：把窗口原生 backing color 从纯白改为与 webview 一致的 `#fafaf5`/`#11120f`，试图在首帧前呈现主题色。实测冷启动首帧仍是 `(253,253,253)` 纯白——WKWebView 首帧前自身为不透明白底，原生背板被遮挡，方案无效（未关闭问题）。
2. **alpha.96（5aef9b2）**：Rust 不再在窗口 build 后立即 `show()`，改为由前端在 settings 就绪/编辑器骨架绘制后 reveal；Rust 保留 1200 ms 兜底显示，避免前端失败时窗口永久隐藏。实测：
   - 窗口首次可见即 1680×954，首帧中心色 **`(249,250,243)`、均匀 luma 246**，与 app 背景 `#fafaf5` 一致，**不再是纯白**；
   - 155 帧／3.95 s，约 0.5 s 内与最终 UI 差异 <2%，无整窗白屏；
   - 应用运行中再打开第二个工程（热打开）两个编辑器窗口均可见、工程名正确，无回归。

## 结论

- 冷启动初期纯白闪屏在本测试场景内已消除（首帧为 app 背景色而非白色）；U22c2b9b4a 可关闭。
- 窗口仍会在约 0.5 s 内从均匀背景过渡到骨架/内容，这一「空白→内容」阶段由 U22c2b9b4 父项继续跟踪（是否需要骨架提前绘制/更长预热），不混同于本次白屏修复。

## 未覆盖

- 多次冷启动统计、窗口透明度（HudWindow）开启下的显示回归、深色主题首帧颜色、前端 JS 失败时 1200 ms 兜底的实际触发、用户观感确认；未使用用户真实工程。

## 证据文件

- `coldreveal.mov`（alpha.96 冷启动窗口首次出现起 4 s 单窗口录像）、`finalframes/r000..r100.png`（首帧/骨架/内容关键帧）。
- `coldback.mov`（alpha.95 对照，首帧仍白）。
- `reveal-fix-summary.json`、`coldreveal-analysis.json`、`coldback-analysis.json`：版本对照、首帧颜色、稳定时间与限制。
- `package-*.json`、`prepare.log`、`install.log`、`release.log.gz`：alpha.96 构建/安装/验签证据。
- `watch-capture-editor.swift`、`analyze-coldreveal.py`、`ui-drive.swift`、`editor-dump.swift`：工具源码。
