# 冷启动打开工程初期白屏/闪屏检测（alpha.94，U22c2b9b4 进展）

安装版 0.2.0-alpha.94／2026.94.0。新建窗口监视采集器：5 ms 轮询应用窗口列表，**编辑器窗口首次出现即开始**单窗口（CGWindowListCreateImage，不采整屏）连续取帧 4 s，检查初期是否存在白屏或加载骨架闪屏。

## 结果（一次冷启动，自有合成工程）

| 阶段 | 观察 |
| --- | --- |
| 0.00–0.60 s | 整窗纯白：whiteFrac≈0.996、meanLuma≈252.9（窗口已 on-screen 可见，内容尚未绘制） |
| ~0.62 s | 首个 UI 内容帧（f062.png：whiteFrac 0.401、meanLuma 234.1） |
| 0.76–1.00 s | 接近加载完成（f100：whiteFrac 0.388、meanLuma 214.1） |
| ≥1.0 s | 稳定编辑器，无进一步整窗变化 |

- 采集质量：164 帧／3.97 s，writer 丢帧 0，最大取帧间隔 30 ms。
- 同期 fallback 诊断（本地标记开启）：窗口出现约 +0.45 s 时 route-suspense connected=true，记录到 `editor/meta pending`、`store/presets fetching`。
- 结论：冷启动打开工程时，编辑器窗口先以**纯白约 0.6 秒**显示，随后才绘制 UI；与用户「初期闪屏」相符。本场景未观察到 alpha58 记录的整窗 EditorSkeleton 多段占位（至少白屏阶段更长且更早）。

## 重要限制

- CGWindowListCreateImage 对“尚未首次提交内容”的窗口可能返回白帧，因此**白屏在屏幕上的实际可见性仍需显示采集或用户观感交叉确认**；0.62 s 之后的 UI 帧是真实渲染内容。
- 仅 1 次冷启动、自有合成工程；未统计白屏时长分布、未测热打开、未做修复与回归。

## 修复方向（待定，不当成已修）

- 编辑器窗口先隐藏，待首帧/关键资源就绪后再显示（带超时兜底）；或首帧前先绘制稳定背景/骨架，避免纯白。
- 需评估对窗口焦点、首次交互与崩溃兜底的影响，并在实际包回归冷/热打开。

## 证据文件

- `coldwatch.mov`：窗口首次出现起的 4 秒单窗口录像。
- `coldframes/f002.png`（白屏）、`f062.png`（首个 UI 帧）、`f067.png`、`f076.png`、`f100.png`（加载过程）等。
- `coldopen-watch-summary.json`、`coldwatch-analysis.json`：阶段统计、诊断记录与结论。
- `coldopen-diag/`：同期 fallback 诊断文件（route-suspense 连接时间、editor/meta 与 store/presets 状态）。
- `watch-capture-editor.swift`、`analyze-coldwatch.py`、`ui-drive.swift`、`editor-dump.swift`：工具源码。
