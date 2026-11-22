# 2026-11-22：`0.2.0-alpha.110`（`2026.110.0`）莱卡暗房 UI 重制与对称弹簧动效打包验证

- **版本**：`0.2.0-alpha.110` / `CFBundleVersion`: `2026.110.0`
- **源码冻结提交**：`4a592d6`（基于 UI 重制提交 `e38f5c4`，分支 `rewrite/cap-foundation`）
- **候选标签**：`next-v0.2.0-alpha.110-candidate`
- **安装路径**：`/Applications/Jianku Screen Next.app`
- **回滚副本**：`/Applications/.jianku-next-update-gURleg/previous.app`（`0.2.0-alpha.109` / `2026.109.0`）
- **签名方式**：按 `docs/开发交接.md` §12 约定使用显式 ad-hoc 签名（`APPLE_SIGNING_IDENTITY=-`）完成单进程构建与全包严格验签。

## 1. 本版主要变更

1. **默认黑红配色与 4 套独立莱卡预设（零残留蓝）**：默认启用 **黑红 · 纯粹莱卡（`graphite-vermilion`）**，提供黑红 / 黑蓝 / 纯黑 / 双标 4 套精调预设 + 壁纸/自选模式；主窗标题栏新增四色快捷切换圆点（`LeicaSeedDots`）；升级冷启动颜色缓存键至 `jianku-color-css-v2`；清零主页、录制记录、编辑器、截图编辑器、区域选框及 Tailwind `--color-blue-*` 的残留硬编码蓝色。
2. **修复切换通道滑块不对称回弹与慢放闪现**：`MotionGroup` 通过 `measureSettledTarget()` 在第 0 帧基于 `.jk-tab-label` 的 `scrollWidth` 预测落位几何，在 `620ms` 展开/收起窗口内屏蔽中间 `ResizeObserver` 抖动且永不中途瞬移；统一使用对称欠阻尼物理弹簧（`response: 0.44, damping: 0.72`）与速度拉伸蓝宝石折射玻璃层（`.jk-selection-pill.is-moving`）。
3. **全界面视觉与动效统一**：重构 `expressive.css` 与 `workspace.css`（保持三层顺序、零重复顶层选择器），统一主页、实时演示、手机投屏、编辑器、截图编辑器、悬浮录制灵动岛与设置页；全面接入进退双层逐字模糊滚字（`MotionText`）与双层光学 LED 冲刺回缩动效（`StatusLed`）。

## 2. 验签与六二进制 SHA-256 核对（源包与安装版逐字节一致）

`codesign --verify --deep --strict --verbose=2` 在源 bundle 与 `/Applications/Jianku Screen Next.app` 均返回 `valid on disk` / `satisfies its Designated Requirement`。

| 可执行文件 | SHA-256（源包 = 安装版） |
| --- | --- |
| `Jianku Screen Next` | `96d8c8fe71df1483a48907b8a623d85df6c1f2dc2e09d86bdf88bf4ea8e201e1` |
| `cap-cli` | `6189d6e280c671f9d1ac83bf950655b8648629e25b41cb85c15545e30407454f` |
| `cap-exporter` | `a1e835c31f8afc4e2d8c25725893f2b5454028575f3a0206ee0d570c7640ab59` |
| `cap-muxer` | `f5ffec3c52a13e3c6fbb80840b3e0232a9b0545b8a7688db7543fdbb5f34d8ba` |
| `jianku-android-capture` | `b91f3f59da634f4960368f72f54e430ec2fbf1aea1b2d4dbe94112fcc1c10672` |
| `jianku-device-capture` | `083c24308268738c0f2952e8504e2d67c71fb24ee2c2f12627d3d99dc971e981` |

## 3. 自动化检查与启动验证

- `bunx tsc --noEmit`：0 错误。
- `vitest.interface.config.ts`：21/21 套件（353/353 用例）通过。
- 纯 TS 单元测试：89/89 套件（787/787 用例）通过（含 4 套莱卡预设浅深色 WCAG 对比度及双向对称回弹测试）。
- `node --test scripts/jianku-hygiene.test.mjs`：4/4 通过；`node scripts/jianku-localization-audit.mjs`：0 占位符不匹配。
- `node scripts/jianku-unattended-check.mjs`：通过。
- 通过 `open -g -a "/Applications/Jianku Screen Next.app"` 后台启动 `alpha.110`（PID `85397`），进程稳定存活、未弹窗抢焦点。

## 4. 诚实边界

- 本次实包验证覆盖构建、严格验签、六二进制一致性、安装启动与前端自动化单测；各界面实际视觉观感、慢放动效体感、实机录屏与跨设备验收仍待用户上手实测。
