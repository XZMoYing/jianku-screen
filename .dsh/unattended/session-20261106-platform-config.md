# 平台构建清单

本轮起点dbaf9eb干净、goal active、周35%无5h；上轮是实际进展，63普通最大化生命周期通过并已推。没有活动构建／导出，当前应用63自有示例保持打开。本轮U12a只改构建清单／脚本，不操作桌面或未知工程，不动网络／安卓／设备。

新增scripts/jianku-config.mjs统一选平台与RFC7396式对象／数组合并；共用配置三通用sidecars，Mac额外移动helper／server／frameworks在tauri.jianku.macos.json。MacbundleVersion等版本字段仍共用，避免版本改两份。jianku.mjs check/build/release、无人值守基线都导入同一配置；config [darwin|win32|linux]只读显示，不crosscompile，不写.env或启动构建。Tauri本地CLI明确接受JSON字符串，实际tauri-build/codegen按JSON merge patch合并，此处没有用prepare.js的旧数组递归方式。

实际CLI三平台输出落证据，Macconfig与dbaf9eb旧完整配置对象相等；3项配置检查通过（Windows/Linux无Mac未生成组件，Mac组件／所有平台素材许可／工程关联保留，数组替换语义）。6文件Biome／Node语法通过。Terra仅重复必要检查：运行前确认无活动Cargo，通过config getter的真实Mac TAURI_CONFIG做cargo check --locked --release -p cap-desktop，句柄78613终态0、约1m02s；Node3项也通过。没有做全量构建／绑定生成或目标平台构建，不能据静态选择称Windows/Linux可用。

证据next/verification/2026-11-06-platform-config/；新使用说明docs/跨平台构建入口.md。U12a可勾，U12–U16父任务与所有既有门槛仍在。当前已验证安装63不换包；后续产品源码/版本改动正常冻结下一包。下一推进U29统一编辑命令／关联轨道的真实编辑结果及默认FCP／全部右键，U30独立光标严格后置；Windows/Linux编译／原生功能与移动边界继续分步完成，完整中文／内部审计／色度15过2失败／硬件成片／延期实机不豁免。

阶段末：周已用36%，无5小时窗口、两张重置券未使用；不设定时。无活动Cargo／完整构建／导出，当前安装63保持可用。本单元提交源码／文档即可，不把配置变更冒充新安装包；全目标保持active。
