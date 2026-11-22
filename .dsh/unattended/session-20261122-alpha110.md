# 2026-11-22：莱卡暗房黑红 UI 重制与 `0.2.0-alpha.110` 打包安装

## 完成事项
1. 完成桌面端全界面莱卡精修 UI 与动效统一重制（提交 `e38f5c4`，29 个文件）：
   - 默认配色切换为 **黑红 · 纯粹莱卡（`graphite-vermilion`）**，提供黑红 / 黑蓝 / 纯黑 / 双标 4 套精调预设、标题栏四色快捷点（`LeicaSeedDots`）与 `jianku-color-css-v2` 冷启动防闪屏缓存；全面清零残留硬编码蓝色；
   - 修复 `MotionGroup` 切换通道滑块左→右/右→左回弹不对称及慢放中途闪现问题（预测最终落位 + 屏蔽展开期 `ResizeObserver` 抖动 + 对称欠阻尼弹簧 + 蓝宝石折射态）；
   - 统一 `expressive.css` 与 `workspace.css`（三层架构、零重复顶层选择器），覆盖主页、实时演示、手机投屏、编辑器、截图编辑器、悬浮录制灵动岛与设置页；
   - 升级 `MotionText` 进退双层逐字模糊滚动，新增 `StatusLed` 双层光学冲刺回缩灯珠并覆盖设备状态与开关。
2. 全量通过 `tsc --noEmit`、`vitest.interface.config.ts`（21/21，353/353）、纯 TS 单测（89/89，787/787）、`jianku-hygiene.test.mjs`（4/4）、`jianku-localization-audit.mjs` 与 `jianku-unattended-check.mjs`。
3. 升级版本至 `0.2.0-alpha.110` / `2026.110.0`，冻结提交 `4a592d6`，打候选标签 `next-v0.2.0-alpha.110-candidate`。
4. 使用 `APPLE_SIGNING_IDENTITY=- node scripts/jianku.mjs release` 完成打包与严格验签，原子替换安装至 `/Applications/Jianku Screen Next.app`（六二进制 SHA-256 与源包逐字节一致），保留 `alpha.109` 回滚副本于 `/Applications/.jianku-next-update-gURleg/previous.app`，清理过期 `alpha.108` 备份，并后台启动 `alpha.110`（PID `85397`）。

## 证据路径
- `next/verification/2026-11-22-alpha110-leica-ui/README.md`

## 待用户实测
- 主页/编辑器/设置页黑红默认观感、四色一键切换与深浅色过渡；
- 顶部模式条与右侧检查器胶囊通道左右往返切换回弹对称性与流畅度；
- 滚字与设备状态绿灯冲刺回缩手感。
