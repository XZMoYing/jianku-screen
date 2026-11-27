# 2026-11-27 会话日志（`0.2.0-alpha.114`）

- 分支：`rewrite/cap-foundation`
- 冻结提交：`9b55a42`（标签：`next-v0.2.0-alpha.114-candidate`）
- 已安装版本：`0.2.0-alpha.114` / `2026.114.0`（`/Applications/Jianku Screen Next.app`，后台运行 PID `99172`）
- 签名：`JiankuLocalSign`（`ABA7E0BD3DCC33AAC18042D416FBE9D78E588D93`，与 `alpha.113` 一致，由 `jianku.mjs` 自动完成，无密码弹窗）
- 回滚保留：`/Applications/.jianku-next-update-yVdN5k/previous.app`（`0.2.0-alpha.113` / `2026.113.0`）；旧 `alpha.112` 回滚已在验证通过后移除。

## 本轮完成

1. 修复捕获来源黑色激活框在取消选择后不一致的问题，点击哪个来源就稳定落在哪个来源。
2. 区域选择顶部工具条补齐圆形关闭「×」并统一去重，同时增加顶部工具条避让高度，彻底消除点击全选（⤢）后上下栏重叠；顺带移除浮层模式下拉中的「实时模式」残余与旧蓝色类。
