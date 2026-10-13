# 简库镜传 Next 品牌资产

用户确认的第二版原稿完整保存在 `jianku-next-logo-approved.png`。保留浅色圆角底、紫色连接画框与克制的蓝、黄绿、薄荷绿内缘。

2026-10-13 按用户反馈修正 Dock 图标外部的白色矩形。本轮使用内置生图工具编辑已有图像，要求只去除圆角图标外的底色和外围光晕，保留图标内部造型与配色。工具生成的透明候选原图保存在 `jianku-next-icon-cutout-generated.png`；批准原稿不被覆盖。

生产图标 `jianku-next-icon.png` 由项目内导出脚本生成：裁取透明候选的圆角底，填补图标内部的透明孔洞，再以 `jianku-next-icon-mask.svg` 的圆角轮廓约束边界。1024×1024 画布外边距透明，图标内部浅色圆角底保持不透明。该遮罩仅处理轮廓，不重绘品牌图案。

`jianku-next-tray.svg` 是独立绘制的单色矢量标记，保留两个画框与连接形状，供 macOS 顶栏使用。应用内的 `icons/jianku/tray.svg` 从此源复制；54×54 PNG 是三倍密度原生模板图标，macOS 以 18 点显示并按菜单栏明暗自动着色。录制时保留明确的停止图标，停止后恢复品牌标记。

可从 `next/cap` 执行 `node scripts/jianku-brand-assets.mjs` 重建生产 PNG、ICNS、ICO、界面及托盘尺寸。脚本读取项目内源资产与遮罩，不依赖生图服务或会话缓存。其他平台的图标容器保留，但当前没有实施 Windows 或移动端应用。
