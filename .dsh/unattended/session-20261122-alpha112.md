# 2026-11-22 会话日志（`0.2.0-alpha.112`）

- 分支：`rewrite/cap-foundation`
- 冻结提交：`79c971f`（标签：`next-v0.2.0-alpha.112-candidate`）
- 已安装版本：`0.2.0-alpha.112` / `2026.112.0`（`/Applications/Jianku Screen Next.app`，后台运行 PID `98925`）
- 回滚保留：`/Applications/.jianku-next-update-Pm0QkJ/previous.app`（`0.2.0-alpha.111` / `2026.111.0`）；旧 `alpha.110` 回滚已在验证通过后移除。

## 本轮完成

1. 对照 `ui-drafts-2026-11/07-leica-sapphire-motion.html` 与实机截图逐项对齐首页莱卡视觉（磨砂标题栏+品牌字标+明暗切换、去旧蓝紫图标、录屏内联红点、磨砂白 `✦ 播放动效`、外部 `ⓘ` + CNC 凹槽 `视频/截图`、无缝单框来源卡+深石墨黑激活态与右上角红灯、无多余灰点设备徽章、3×3 壁纸外置标题）。
2. 为首页与编辑器所有栏位尺寸变化建立统一平滑空间过渡（`--jk-spatial`），解除 `.jk-workspace-controls` 硬编码 `transition: none`，仅在手动拖拽分割条 `[data-resizing="true"]` 时保持 1:1 跟手。
3. 通过 Biome、静态卫生守卫（4/4）、本地化审计（0 占位符不匹配）、`tsc`（0 错误）、DOM 界面单测（21/21，353/353），完成签名打包、原子替换、严格验签、6 二进制 SHA-256 核对与后台启动。
