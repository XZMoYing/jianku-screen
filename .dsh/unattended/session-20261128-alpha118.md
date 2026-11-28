# 2026-11-28 会话日志（0.2.0-alpha.118 剪辑侧栏与声音面板 UI 统一）

- **时间**：2026-11-28 18:43–19:10（Asia/Shanghai）
- **需求**：统一剪辑面板 UI（尤其声音面板），对齐 `alpha.115–117` 新增素材/上下文检视器与 Leica 黑红蓝宝石设计系统。
- **代码冻结**：`ee7c9e7`（标签 `next-v0.2.0-alpha.118-candidate`）
- **改动摘要**：
  - `expressive.css` 新增 `.jk-ed-card`、`.jk-ed-icon-tile`、`.jk-ed-seg`、`.jk-ed-seg-item`、`.jk-ed-tile`、`.jk-ed-num-input`、`.jk-ed-nudge`。
  - `InterfaceMotion.tsx` 让 `<MotionGroup>` 支持 `aria-checked=true`，并在无选中项（如 EQ 切到 `custom`）时淡出滑块。
  - `ConfigSidebar.tsx` 重构声音面板分区（音量与声道 / 人声增强 / 同步），三张人声增强卡补齐统一图标位与边框，修复降噪描述与声道选项未本地化问题，EQ 滑块统一为 `<Field inline>`，音频段/遮罩段/缩放段/同步偏移均统一到 Leica 原语并清零遮罩旧蓝色类。
  - `AudioLibrary.tsx`、`ClipsSidebar.tsx`、`MaterialsTools.tsx`、`InspectorSections.tsx`、`ClipProperties.tsx`、`ClipInspector.tsx`、`TransitionInspector.tsx`、`shape-segment-config.tsx`、`image-segment-config.tsx`、`text-segment-config.tsx`、`three-d-panel.tsx` 全面统一卡片、分段条、真 `<Toggle>` 与网格选中态。
- **验证**：Biome 0 错误、样式卫生 4/4、本地化占位符 0 错配、`tsc --noEmit` 0 错误、DOM 测试 21/21（357/357）；`JiankuLocalSign` 签名包构建、严格验签、6 二进制 SHA-256 一致、原子替换安装与后台启动（PID `8150`）全部通过。
- **安装与回滚**：已安装 `0.2.0-alpha.118`（`2026.118.0`），回滚保留 `0.2.0-alpha.117`（`/Applications/.jianku-next-update-5DL6MT/previous.app`）。
