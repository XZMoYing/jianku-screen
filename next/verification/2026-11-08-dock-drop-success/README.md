# Dock 拖放打开工程（alpha.108，U24）

## 结果

- 场景：应用运行于首页；Finder 图标视图打开 `/private/tmp/jianku-alpha108-20261108`。
- 坐标：`转场验收.jks` AXImage (1206,447) 64×64 → 中心 (1238,479)；Dock 项 Jianku Screen Next (1449.97,980.96) 53×64 → 中心 (1476,1013)。
- 用 CGEvent drag-screen 30 步 + 1200ms hover 拖到 Dock 图标：**编辑器打开，工程名「转场验收」与拖动文件一致**。
- 此前 Finder **列表视图**多次拖放未打开；图标视图 + 悬停成功。

## 结论

U24 Dock 拖放（**运行中应用**）通过：从 Finder 图标拖到运行中应用 Dock 图标可打开对应工程。

## 未覆盖

- 冷启动（应用未运行、需固定 Dock 图标）拖放——未修改用户 Dock；
- 列表视图拖放（此前失败）；多文件/异常文件/权限错误；Dock 顺序/用户自定义布局。

## 证据

- dock-success-summary.json；finder3.json（Finder 图标 AX 位置）；dock-icon2.json（Dock 项位置）；dock3-dump.json（打开后的编辑器工程名）。
