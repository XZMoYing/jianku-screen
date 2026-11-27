# 2026-11-27 会话日志（`0.2.0-alpha.113`）

- 分支：`rewrite/cap-foundation`
- 冻结提交：`9ff379f`（标签：`next-v0.2.0-alpha.113-candidate`）
- 已安装版本：`0.2.0-alpha.113` / `2026.113.0`（`/Applications/Jianku Screen Next.app`，后台运行 PID `80889`）
- 签名证书：`"JiankuLocalSign"`（`ABA7E0BD3DCC33AAC18042D416FBE9D78E588D93`，`~/Library/Keychains/login.keychain-db`），已更新 `next/cap/scripts/jianku.mjs` 默认采用该证书。
- 回滚保留：`/Applications/.jianku-next-update-ZkL1rE/previous.app`（`0.2.0-alpha.112` / `2026.112.0`）；旧 `alpha.111` 回滚已在验证通过后移除。

## 本轮完成

1. 修复用户深度体验反馈的全部 14 项问题与需求：首页预览默认空白、左侧栏目升降掉帧与元素重载、麦克风文案切换缺失滚动文字动效、演示放大倍率滑块统一、设置窗口阴影与圆角统一、导出完成界面毛刺、Material 3 Expressive 波纹导出进度环、导出资源检查弹窗全量汉化与去 Cap、录制库批量选择导出工程到新建文件夹，以及全设置页 Cap / Instant / Discord / 外部跳转与未汉化文案清零。
2. 解决长期升级重授权限痛点：生成 10 年期 `"JiankuLocalSign"` 证书导入登录钥匙串（免弹密码框），完成全包由内向外签名与严格验签（Designated Requirement 绑定固定证书指纹）。
