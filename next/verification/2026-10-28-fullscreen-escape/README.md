# U05b：提示气泡与全屏Escape配合

2026-10-28，源码eac304f，完整包alpha.44/2026.44.0已安装、归档并打开；三处六程序严格ad-hoc签名/SHA相同，见delivery-alpha44.json。当前包未包含随后U19的外框/3D阴影修改。

Kobalte Tooltip的DismissableLayer在document处理Escape并preventDefault；原Editor的window监听跳过所有defaultPrevented，导致提示气泡与全屏退出冲突。旧包真实悬停出现“退出全屏预览”气泡后，首按Escape仍保留预览、再按退出，原始截图/状态及alpha43-hover-red.json保留。较早无悬停的焦点/双按观察见alpha43-event-observations.json，不能把所有UI辅助程序的启动/Spaces选择失败都算产品失败。

修正只为Tooltip消费的同一个键盘事件做弱引用标记；Editor允许该事件继续退出全屏。其他菜单/对话框仍有优先权，Tooltip在dialog/alertdialog/menu/listbox内也不越过这些层。提示外观与打开/关闭行为保留，不改变媒体渲染或项目配置。

alpha.44真实界面：先进入macOS系统全屏、再进入预览并实际悬停，确认气泡可见；一次Escape退出预览，仍保留原系统全屏（native=1）。见alpha44-hover-escape.json及前后AX。另实际打开质量菜单，Escape只关闭菜单，预览继续全屏；再次Escape才退出预览并保留系统全屏，随后外部退出恢复1275×800/(202,102)。见alpha44-acceptance.json。暂停0帧全屏内/外RGBA载荷SHA与alpha.43完全一致，实际1280×720。结合U05a的播放、定位、菜单、窗口/项目证据，U05/U05b可以关闭。

8项DOM事件顺序/Tooltip/菜单/四类模态保护回归，连同全屏、清晰度、布局、交接与语言共51项通过；类型和完整桌面release成功。恢复基线使用现有无人值守入口且通过；首次手工PATH漏Node并未启动构建，修正后仅运行一次完整入口。相关log.gz保存，不代表全部发布审计或物理验收通过。

UI辅助程序只操作当前本产品PID的合成编辑器，读取自有AX聚焦窗口，CG窗口改为只查询屏上窗口，避免Spaces把离屏副本混入点击目标。真实点击先使本产品前台、等待屏上自有编辑器唯一，再用新AX坐标；不会因递送失败重启产品构建或改系统设置。UI脚本路径/版本需在独立临时目录同步，监听端口每次从当前进程查询，旧PID/端口不可直接复用。没有保存用户画面载荷。

用户切换账号后重读已用5%（约剩95%），后续7%/10%；前一账号100%不沿用到本账号。goal已active，继续完整目标。用户新增优先U19：现代浏览器外框与透视投影后的阴影，已保留六组修改前完整导出，下一步实施。其后完整中文/本土化、内部发布审计、Windows/Linux及已有两个严格解码色度失败继续待办。
