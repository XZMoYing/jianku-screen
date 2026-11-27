# `0.2.0-alpha.113`（`2026.113.0`）深度体验修复、Material 3 波纹导出环、批量工程导出与固定签名验收记录

- 日期：2026-11-27（Asia/Shanghai）
- 冻结源码提交：`9ff379f`
- 标签：`next-v0.2.0-alpha.113-candidate`
- 安装位置：`/Applications/Jianku Screen Next.app`
- 回滚备份：`/Applications/.jianku-next-update-ZkL1rE/previous.app`（`0.2.0-alpha.112` / `2026.112.0`）
- 签名证书：`"JiankuLocalSign"`（`ABA7E0BD3DCC33AAC18042D416FBE9D78E588D93`，位于登录钥匙串 `~/Library/Keychains/login.keychain-db`）
  - Designated Requirement：`identifier "com.jianku.screen.next" and certificate root = H"aba7e0bd3dcc33aac18042d416fbe9d78e588d93"`（固定证书锚定，不再随每次编译更换 CDHash，后续升级免重复授 TCC 权限）

## 改动摘要（共 14 项）

1. **首页默认预览空白修复**（`CaptureStage.tsx` + `frame-worker.ts`）：WebGPU 帧统一走 `requestAnimationFrame` 呈现、缓存最近一帧 RGBA 缓冲支持 `repaint`、移除初始 `opacity: 0` 导致的 OffscreenCanvas 首帧空白，并在首次 `frame-rendered`、窗口恢复可见与容器尺寸稳定后触发重绘。
2. **左侧栏目升降不掉帧、不重载元素**（`new-main/index.tsx` + `InterfaceMotion.tsx` + `workspace.css`）：将 `<TargetSelectionHome />` 持久化在 `<MotionPanel visible={!menu()}>` 内不再随二级菜单开关销毁重建；子页切换移除高开销 `blur` 滤镜，收紧 `flex-basis` 过渡至 `360ms` 并添加 `will-change` 与 `contain: layout style`。
3. **麦克风等设备名称切换补齐滚动文字动效**（`MotionText.tsx`）：接入 `useMotionInteraction()`，当面板隐藏期间设备文案变化（如从二级列表选中「MacBook Air 麦克风」），返回首页瞬间从上次可见文案平滑滚动过渡至新文案。
4. **演示模式「放大倍率」滑块视觉统一**（`presentation.tsx` + `expressive.css`）：补充 `--jk-progress` 进度变量并将 `.studio-range input[type="range"]` 统一为莱卡游标刻度条＋朱红指针样式。
5. **设置窗口阴影与圆角统一**（`windows.rs` + `platform/macos/mod.rs` + `macos-window-material.ts`）：将设置窗口与主窗口统一走 `SystemManaged` Liquid Glass 与 `16px` 圆角，并显式调用 `setHasShadow: true` + `invalidateShadow` 恢复原生 macOS 阴影。
6. **导出完成界面去除背景毛刺**（`ExportPage.tsx` + `expressive.css`）：将脆弱的 `.jk-export > div:last-child > div:last-child` 改为显式 `.jk-export-sidebar`，消除导出完成按钮后方的不透明矩形块。
7. **导出进度圈升级为 Material 3 Expressive 波纹圆环**（`ExportPage.tsx`）：动态正弦波纹进度弧＋留白分隔轨道，自适应 4 套主题色与深浅外观，兼容确定/不确定进度与减弱动态效果。
8. **导出资源检查弹窗全量汉化并去 Cap 品牌**（`crates/utils/src/export_resources.rs` + `export.rs`）：中文界面展示「检查导出资源」「仍然继续」「返回」及中文内存/磁盘提示，正文改为「简库镜传 Next」。
9. **录制库新增批量导出工程功能**（`recordings_locations.rs` + `lib.rs` + `settings/recordings.tsx`）：「导入」旁新增「导出」入口，支持多选、全选、取消全选、反选，选择目录后自动新建带时间戳子文件夹复制全部所选录制工程并打开目标文件夹。
10. **清理设置页残余 Cap / Instant / Discord / 外部跳转与未汉化文案**：
    - 转写提示词默认与旧配置自动迁移清理 `Cap` / `My Brand Name` / `mywebsite.com`（`general_settings.rs` + `general-settings.ts`），侧栏「转录」统一为「转写」。
    - 移除侧栏「集成」入口及跳往 Cap 的 Google Drive / S3 配置，页面替换为本地占位。
    - 反馈页移除「加入 Discord」按钮并保留「加入社区」占位，诊断链路去除 Instant 选项并汉化 `"Starting..."`。
    - 录制库移除 `Show all` / `Instant` / `Studio` 选项卡并汉化空态；录制画质移除 Instant 与分享链接区块；通用设置移除「上传后删除 Instant 录制」；快捷键移除 Instant/模式循环项；自动化移除 Instant 触发器与 Discord 文案；导出页提示去掉实时模式残留并汉化剪贴板成功提示。

## 自动化与安装验证

- `bunx biome check`：0 错误
- `node --test next/cap/scripts/jianku-hygiene.test.mjs`：4/4 通过
- `node next/cap/scripts/jianku-localization-audit.mjs`：0 占位符错配
- `cd next/cap/apps/desktop && bunx tsc --noEmit`：0 错误
- `bun run vitest run --config vitest.interface.config.ts`：21/21 套件通过（353/353）
- `bun run vitest run src/utils/general-settings.test.ts`：14/14 通过（含旧 `Cap` 提示词迁移测试）
- `cargo test -p cap-utils export_resources`：12/12 通过
- `cargo test -p cap-desktop batch_export_projects`：1/1 通过
- 严格验签：`codesign --verify --deep --strict --verbose=2 "/Applications/Jianku Screen Next.app"` 通过
- 六二进制 SHA-256 源包与安装版 6/6 完全一致：
  - `Jianku Screen Next`: `26c3cfee2a5ad775151c7869124656016da030cb01b9155bec87e02049814f1c`
  - `cap-muxer`: `ae7e79111f7bda7ab60375794f4244ae7b6bad5d358f20fccd1adc1fed6291a8`
  - `cap-exporter`: `0433fb1e30be6a6f1c59fd0d31dbd81686cfec15a4b84ed2882b42bf17417611`
  - `cap-cli`: `331829377670120f69c59cff03b76af90303b5386a503c6fe803d1c9fcf31388`
  - `jianku-device-capture`: `33585ba2994dbcf3ee317819fb90f405782b20725b25ad7da0488e95e1ba34f1`
  - `jianku-android-capture`: `7ca829753350066ffe70c21ccbac5bc6c4812b8ae2bffaa783787a9de4c777a3`
- 后台启动：`open -g -a "/Applications/Jianku Screen Next.app"` 成功（PID `80889`）

## 诚实边界

- 视觉观感、预览首帧即时显示、左侧栏目升降顺滑度、Material 3 波纹进度视觉效果、设置窗口阴影以及首次切换 `"JiankuLocalSign"` 签名后的系统 TCC 权限继承效果，均需在本机界面实机确认。
