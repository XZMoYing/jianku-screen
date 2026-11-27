# `0.2.0-alpha.114`（`2026.114.0`）捕获来源选中状态统一与区域选择工具栏修复验收记录

- 日期：2026-11-27（Asia/Shanghai）
- 冻结源码提交：`9b55a42`
- 标签：`next-v0.2.0-alpha.114-candidate`
- 安装位置：`/Applications/Jianku Screen Next.app`
- 回滚备份：`/Applications/.jianku-next-update-yVdN5k/previous.app`（`0.2.0-alpha.113` / `2026.113.0`）
- 签名证书：`JiankuLocalSign`（`ABA7E0BD3DCC33AAC18042D416FBE9D78E588D93`，由 `jianku.mjs` 自动签名，Designated Requirement 与 `alpha.113` 完全一致）

## 改动摘要

1. **捕获来源黑色激活框逻辑统一**（`new-main/index.tsx`）：新增 `preferredSourceKind` 状态，在点击 `屏幕 / 窗口 / 区域 / 仅摄像头` 或下拉选择/快捷键触发时即时更新；关闭选择浮层未开始录制时，黑色激活框始终准确停留在最近一次点击的捕获来源上。
2. **区域选择顶部工具条补齐统一关闭「×」按钮**（`target-select-overlay.tsx`）：在区域选择顶部磨砂胶囊左侧增加圆形关闭「×」按钮，未框选区域前也可一键关闭，并隐藏下方 `RecordingControls` 重复的「×」按钮。
3. **修复区域选择点击全选（⤢）后控制栏与顶部工具条重叠**（`target-select-overlay.tsx`）：将 `controlsStyle()` 的顶部避让阈值提升为 `TOP_TOOLBAR_CLEARANCE = (macos ? 48 : 16) + 48 + 16`（macOS `112px`），无论框选靠顶还是全屏填充，下方录制控制栏始终位于顶部工具条下方并留出 `16px` 间距。
4. **顺带清理**：移除浮层录制模式菜单中残余的「实时模式」项，并将「固定区域」激活态与无麦确认勾选框统一为 `--jk-primary` 主题色。

## 验证结果

- `bunx biome check`：0 错误
- `node --test next/cap/scripts/jianku-hygiene.test.mjs`：4/4 通过
- `cd next/cap/apps/desktop && bunx tsc --noEmit`：0 错误
- `bun run vitest run --config vitest.interface.config.ts`：21/21 套件通过（353/353）
- `node scripts/jianku.mjs release`：自动以 `JiankuLocalSign` 签名并严格验签通过
- 安装版严格验签通过、6 二进制 SHA-256 字节级一致、后台启动成功（PID `99172`）

## 诚实边界

- 捕获来源选中框交互手感、区域全选避让间距与从 `alpha.113` 升级到 `alpha.114` 的 TCC 权限继承效果仍需在本机界面实机确认。
