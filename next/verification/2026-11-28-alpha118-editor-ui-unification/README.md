# 2026-11-28 `0.2.0-alpha.118` 剪辑侧栏与声音面板 UI 统一验证报告

- **版本**：`0.2.0-alpha.118` / `2026.118.0`
- **冻结提交**：`ee7c9e7`（标签 `next-v0.2.0-alpha.118-candidate`）
- **安装路径**：`/Applications/Jianku Screen Next.app`
- **回滚版本**：`0.2.0-alpha.117`（`/Applications/.jianku-next-update-5DL6MT/previous.app`）
- **签名证书**：`JiankuLocalSign`（`ABA7E0BD3DCC33AAC18042D416FBE9D78E588D93`，登录钥匙串固定签名）

## 1. 改造范围

1. **统一剪辑检视器 Leica 原语（`styles/expressive.css`、`components/InterfaceMotion.tsx`）**
   - 新增统一语义类：`.jk-ed-card`（带边框与顶部微光的卡片容器）、`.jk-ed-icon-tile`（30×30 图标徽章，启用态点亮朱砂红强调色）、`.jk-ed-seg` / `.jk-ed-seg-item`（CNC 凹槽分段选择器，配 `<MotionGroup>` 磨砂滑块，并让 `<MotionGroup>` 支持 `aria-checked=true` 且在无激活项如自定义 EQ 时自然淡出滑块）、`.jk-ed-tile`（多行网格统一使用石墨黑激活态）、`.jk-ed-num-input` / `.jk-ed-nudge`（等宽数字与毫秒微调钮）。
2. **声音面板重构与统一（`routes/editor/ConfigSidebar.tsx`、`routes/editor/AudioLibrary.tsx`）**
   - 右侧声音页按「音量与声道」「人声增强」「同步」三段清晰分组：静音、麦克风/系统音量、立体声模式归入同一 `.jk-ed-card` 卡片，避免音量滑块孤立悬浮在分区外。
   - `StudioSoundCard`、`AutoLoudnessCard`、`VoiceEqCard` 三张增强卡统一为 `.jk-ed-card` + 30×30 `.jk-ed-icon-tile` 图标位（麦克风 / 响度表 / 均衡器）+ 标题副标题 + `<Toggle>`。
   - 降噪挡位、人声 EQ 五预设（单行不换行）、消除口水音三挡位统一改为 `.jk-ed-seg` + `<MotionGroup>`；修复 `StudioSoundCard` 挡位说明与麦克风声道选项漏包 `localize(...)` 的英文残留。
   - 人声 EQ 四个频段滑块改用 `<Field inline>`，与全站 `.jk-field-val` 等宽读数胶囊及拖动高亮保持一致；低切滤波改用 `<Subfield>`。
   - 音画同步 `SyncOffsetsConfig` 与 `SourceOffsetField` 放入 `.jk-ed-card`，移除 `-mt-2` 偏移与旧 `bg-gray-1` 按钮，改为 `.jk-ed-num-input` + `.jk-ed-nudge`。
   - 左侧素材区「音频」页（`AudioLibrary.tsx`）和音频片段检视卡（`AudioSegmentConfig`）同步清理旧 `bg-gray-*` / `ring-offset-gray-200`，改用 `.jk-ed-card`、`.jk-ed-tile` 与 `--ed-*` 语义色。
3. **全剪辑面板其余控件统一**
   - `InspectorSections.tsx`、`ClipsSidebar.tsx`、`text-segment-config.tsx`（`Segmented`）、`three-d-panel.tsx`（`MiniSegmented`、`PanelGroup`）、`MaskSegmentConfig`（清除残留 `border-blue-8` / `bg-blue-9`）统一使用 `.jk-ed-seg` + `<MotionGroup>` 与 `.jk-ed-card`。
   - `ClipProperties.tsx` 移除手写假开关（含 Tailwind v4 `translate-x-full` 偏移问题），改用标准 `<Toggle size="sm" />`、`<Field inline>` 与 `.jk-ed-seg`；`ClipInspector.tsx` 时长读数卡片采用 `.jk-ed-card` + 等宽数字。
   - `TransitionInspector.tsx`、`MaterialsTools.tsx`、`shape-segment-config.tsx`、`image-segment-config.tsx`、`text-segment-config.tsx` 网格与分组卡片统一为 `.jk-ed-card` / `.jk-ed-tile` / `.jk-ed-seg`。
   - 缩放多选与 3D 多选标题补齐中文化并同步 `en.json`。

## 2. 自动化与安装验证结果

- `bunx biome check --write`（16 个改动文件）：0 错误
- `node --test scripts/jianku-hygiene.test.mjs`：4/4 通过（三层样式栈无重复顶层选择器、无旧紫色硬编码）
- `node scripts/jianku-localization-audit.mjs`：`placeholderMismatches: 0`（`zh-CN: 1776`，`en: 1921`）
- `bunx tsc --noEmit`：0 错误
- `bun run vitest run --config vitest.interface.config.ts`：21/21 文件，357/357 用例通过
- 签名构建与安装：`codesign --verify --deep --strict` 源码包与 `/Applications/Jianku Screen Next.app` 均通过，Designated Requirement 为 `identifier "com.jianku.screen.next" and certificate root = H"aba7e0bd3dcc33aac18042d416fbe9d78e588d93"`；6 个二进制 SHA-256 完全一致；后台启动成功（PID `8150`）。

## 3. 验收边界

- 本轮已完成前端静态、样式卫生、本地化、DOM 交互测试、签名打包、验签及后台启动核验；声音面板与各片段检视器在真实工程中的主观视觉手感待用户切到窗口复核。
