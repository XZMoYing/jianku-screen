# 首次新建编辑器的最大化顺序

上轮有实质进展：安装62、确认3D衔接UI／保存／原生播放，并留下首次打开尺寸失败证据，提交a836d32已推。本轮先get_goal确认为active、工作区干净、无活动构建；周额度30%／无5h／两券不动。当前源冻结eed7e9c；唯一release13906日志/private/tmp/jianku-alpha63-20261106/release.log运行中，不重复构建、不改CAP输入。

根因源码链：Tao 0.37.1 macOS window.rs set_maximized检查调用时is_zoomed，再交给util/async.rs set_maximized_async，后者主队列中直接NSWindow.zoom切换而不重新判定。我们builder.maximized(true)和fit后maximize的两个异步调用可能在首次执行前都看到false，排入两个切换，最终还原；原有fit会另行调主队列，进一步放大时序差异。窗口状态插件已denylist映射后的editor，不归咎插件；前端reveal/effects没有尺寸设置。删除builder提前请求，保留fit完成后的单次maximize；Rust fmt／cap-desktop release check终态0。

当前62自有连贯3D镜头工程（非未知用户工程）经正常AXZoomWindow还原为1275×800，尚在运行，便于63从非最大化初态验收；62回滚归档六程序／签名通过。63验证工具仅prepared；后续release终态→prepare→确认自有工程并保存/正常退出→install→首次文件open/普通还原/重开/最小化核对。不要把源码或一次重开当所有入口已通过，不能改内置数据库或强行终止用户工程。

原完整目标继续：U27整体默认舒适、U28拖动光标、U29工作流/主轨磁吸与吸附/全部右键和默认FCP、其后U30独立光标，中文/审计/色度15过2失败/硬件成片/Windows/Linux/延期设备不豁免。只做必要验证与实际交互，用户要求产品体验，不堆防御性测试。

构建期间Terra只读平台盘点已入research/2026-11-06-Windows-Linux构建入口盘点.md；找到非Mac清单强制缺失移动helper的具体阻塞，U12a列为冻结结束后可做的实质步骤。没有改CAP输入、没有触发CI，不把共享源码称为平台通过。
