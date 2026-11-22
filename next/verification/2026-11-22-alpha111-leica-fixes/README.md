# 2026-11-22：`0.2.0-alpha.111`（`2026.111.0`）草稿深度对齐与回归修复打包验证

- **版本**：`0.2.0-alpha.111` / `CFBundleVersion`: `2026.111.0`
- **源码冻结提交**：`7e93374`（分支 `rewrite/cap-foundation`）
- **候选标签**：`next-v0.2.0-alpha.111-candidate`
- **安装路径**：`/Applications/Jianku Screen Next.app`
- **回滚副本**：`/Applications/.jianku-next-update-vapuca/previous.app`（`0.2.0-alpha.110` / `2026.110.0`）
- **签名方式**：显式 ad-hoc 签名（`APPLE_SIGNING_IDENTITY=-`）单进程构建与严格验签。

## 1. 修复与对齐范围

1. **开关滑块飞出修复（`Toggle.tsx` + `expressive.css`）**：移除 Tailwind v4 独立 `translate` 类 `data-checked:translate-x-[calc(100%)]`，消除与 `transform: translateX(...)` 的双重位移叠加；按草稿精算对齐 `48×25px` 轨、`26×19px` 拇指、`16px` 行程（兼容 `sm`/`md`/`lg`），并保留光学 LED 与按压蓝宝石抬升态。
2. **设置窗口改为独立普通窗口（`windows.rs` + `lib.rs`）**：打开设置时不再调用 `hide_recording_windows(app, true)` 隐藏主窗口，关闭设置也不再强制接管恢复主窗口，新增 `minimizable(true)`。
3. **录制中悬浮灵动条按草稿重构（`in-progress-recording.tsx` + `windows.rs` + `fake_window.rs`）**：重构为 50px 蓝宝石毛玻璃胶囊条（左侧拖拽点 + 脉冲红点/暂停琥珀点 + 等宽计时器 + 细分隔线 + 暂停/静音与 5 段实时绿灯音量条/书签/重录/删除/设置圆钮 + 右侧朱砂红「停止」胶囊），窗口与热区宽度拓宽至 `432px`，同步更新并全部通过 19/19 `fake_window` 单测。
4. **编辑器多处草稿对齐（`Player.tsx`、`Timeline/index.tsx`、`Timeline/styles.css`、`expressive.css`、`expressive-motion.ts`）**：
   - 时间线缩放迷你滑块改为草稿 `.jk-range.mini`（8px 胶囊轨 + 4×15px 居中朱砂游标）；
   - 时间线右上角磁吸/吸附工具收进独立 `.jk-tl-right-tools` 容器，彻底消除重叠；
   - 内凹取景器舞台与四角准星移至真正 `<PreviewCanvas>`（`.jk-viewfinder-stage`），补齐顶栏分割线、`720p`/`1x` 磨砂芯片与圆形毛玻璃播放键；
   - 时间线轨道改为内凹 `--jk-well`，视频片段恢复草稿高对比 `--jk-panel-hi` 卡片 + 石墨色左侧竖条（仅选中时主色高亮），播放头顶帽改为 `10×10` 机加工方圆角；
   - 去除平铺工具栏 `.jk-button` 静息态凸起阴影与禁用灰底，补齐主按钮点击光学微光脉冲（`.jk-press-pulse`）并去除标签点击残留焦点框。

## 2. 验签与六二进制 SHA-256 核对（源包与安装版逐字节一致）

`codesign --verify --deep --strict --verbose=2` 在源 bundle 与 `/Applications/Jianku Screen Next.app` 均返回 `valid on disk` / `satisfies its Designated Requirement`。

| 可执行文件 | SHA-256（源包 = 安装版） |
| --- | --- |
| `Jianku Screen Next` | `f39dca78e5448374ffe1d8d26b962859b5ee4e44f6fc8702568cc5800fc948a0` |
| `cap-cli` | `45d6a56167ce30f32bf1326b76a1e2baf281c60bb99d453ff3fdbea6c4c639ce` |
| `cap-exporter` | `6b4b83c1cde696b49d60c2336a8a974d3840036a9b7c6bbcaf6b4d278a743ec1` |
| `cap-muxer` | `f5ffec3c52a13e3c6fbb80840b3e0232a9b0545b8a7688db7543fdbb5f34d8ba` |
| `jianku-android-capture` | `b91f3f59da634f4960368f72f54e430ec2fbf1aea1b2d4dbe94112fcc1c10672` |
| `jianku-device-capture` | `083c24308268738c0f2952e8504e2d67c71fb24ee2c2f12627d3d99dc971e981` |

## 3. 自动化检查与启动验证

- `bunx tsc --noEmit`：0 错误。
- `vitest.interface.config.ts`：21/21 套件（353/353 用例）通过。
- `node --test next/cap/scripts/jianku-hygiene.test.mjs`：4/4 通过。
- `cargo fmt --all -- --check` 与 `cargo test --locked -p cap-desktop --lib fake_window`：19/19 通过。
- 通过 `open -g -a "/Applications/Jianku Screen Next.app"` 后台启动 `alpha.111`（PID `92406`），稳定存活、未弹窗抢焦点。
