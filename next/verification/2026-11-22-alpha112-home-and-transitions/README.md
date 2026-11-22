# `0.2.0-alpha.112`（`2026.112.0`）首页草稿像素对齐与全栏统一过渡动画验收记录

- 日期：2026-11-22（Asia/Shanghai）
- 冻结源码提交：`79c971f`
- 标签：`next-v0.2.0-alpha.112-candidate`
- 安装位置：`/Applications/Jianku Screen Next.app`
- 回滚备份：`/Applications/.jianku-next-update-Pm0QkJ/previous.app`（`0.2.0-alpha.111` / `2026.111.0`）

## 改动摘要

1. **首页逐项像素级对齐莱卡草稿**
   - 顶栏升级为半透明磨砂 `.jk-window-titlebar`（`42px`），左侧加入莱卡朱红双框品牌标识与 `简库镜传 Next` 字标，右侧在 4 枚精调色点旁补齐明暗主题月/日切换钮（`LeicaThemeToggle`）。
   - 移除次顶栏左侧旧蓝紫图标，让 `录屏 • / 演示` 左对齐，并将 `录屏` 选中红点由底部绝对定位改为标签右侧内联光学红点。
   - 预览台底栏 `播放动效` 改为草稿同款蓝宝石磨砂白胶囊并补齐 `✦` 图标。
   - 控制卡右上角 `ⓘ` 移到 `视频 / 截图` 外部左侧，`视频 / 截图` 收进 CNC 凹槽 `.jk-mode-seg` 与滑动磨砂选中胶囊。
   - `屏幕 ⌄ / 窗口 ⌄` 改为单层无缝玻璃框 `.jk-source-split`，当前激活来源卡片（`activeSourceKind()`）呈现深石墨黑底、白字与右上角发光朱红指示灯。
   - 设备状态角标在关闭／待授权态隐藏多余灰点，启用态平滑展开并亮起绿色 LED。
   - 右侧壁纸缩略图拆分为干净 `16:10` 画面与下方标题，默认展示 `3×3`（9 张）使下方画面与布局滑块立即可见。
   - 清除 `录制库 / 截图库` 打开全部时残留的 `hideCurrentWindow()` 调用，彻底保证打开设置不隐藏主窗口。
2. **全界面栏位变化统一平滑过渡动画**
   - 定义 `--jk-spatial: cubic-bezier(0.22, 1, 0.36, 1)`，移除 `.jk-resizable-workspace .jk-workspace-controls` 上硬编码的 `transition: none`，改为仅在 `[data-resizing="true"]` 拖拽分割条期间禁用过渡。
   - 当点击 `录制库 / 截图库`、切换录制/演示/手机与平板来源，或非拖拽调整侧栏/时间线尺寸时，首页左侧控制栏、预览台、右侧栏以及编辑器画布/侧栏/时间线均具备统一的平滑空间过渡动画；新增轨道行补齐 `.jk-track-row` 入场过渡。

## 自动化与打包验证

- `bunx biome check --write`：0 错误（仅 `prefers-reduced-motion` 内既有 4 条 `!important` 警告）
- `node --test next/cap/scripts/jianku-hygiene.test.mjs`：4/4 通过（3 层样式栈、0 重复顶层选择器、0 残留旧紫、0 坏链）
- `node next/cap/scripts/jianku-localization-audit.mjs`：0 占位符不匹配（补齐 `浅色外观` / `深色外观` 英文词典）
- `cd next/cap/apps/desktop && bunx tsc --noEmit`：0 错误
- `cd next/cap/apps/desktop && bun run vitest run --config vitest.interface.config.ts`：21/21 套件通过（353/353 用例）
- `APPLE_SIGNING_IDENTITY=- node scripts/jianku.mjs release`：构建与签名通过
- 严格验签：`codesign --verify --deep --strict --verbose=2 "/Applications/Jianku Screen Next.app"` 通过（`valid on disk`、`satisfies its Designated Requirement`）
- 六个二进制 SHA-256 源包与安装版 6/6 字节级一致：
  - `Jianku Screen Next`: `b27674d1dfeb84d27554ef2ab6eb6d82a23ffaf0bc0cff4e913e638bcb728ff5`
  - `cap-muxer`: `f5ffec3c52a13e3c6fbb80840b3e0232a9b0545b8a7688db7543fdbb5f34d8ba`
  - `cap-exporter`: `58d0dc620b4d8ebc1fbe9e71dc7a8f79ff3c41895a4fcc469d954b7bf4310991`
  - `cap-cli`: `79b6f7fd8c333e833545ac642cc6ae846f8c342247e0930bd420475829fbad2c`
  - `jianku-device-capture`: `083c24308268738c0f2952e8504e2d67c71fb24ee2c2f12627d3d99dc971e981`
  - `jianku-android-capture`: `b91f3f59da634f4960368f72f54e430ec2fbf1aea1b2d4dbe94112fcc1c10672`
- 后台启动：`open -g -a "/Applications/Jianku Screen Next.app"` 成功（PID `98925`）

## 诚实边界

- 视觉观感、点击录制库/切换面板的肉眼过渡手感及实机录屏/导出仍待用户本机界面亲自确认；本次自动化未覆盖真实屏幕录制权限与连续视觉帧对比。
