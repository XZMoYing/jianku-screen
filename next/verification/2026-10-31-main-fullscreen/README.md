# Main置顶与原生全屏

2026-10-31用户允许电脑空闲期间前台验收。alpha.49普通Main可全屏，但置顶后绿色按钮只最大化（AXFullScreen=false、CG layer5）。失败输出保留；不是按钮可用就算通过。

原生AppKit最小程序在floating级别复现：默认collection=0只zoom，显式FullScreenPrimary=128则进入系统全屏。修正只在Mac Main创建时显式声明primary fullscreen能力，Pin升降级与权限临时降级无需改动，也不改变录制控制等其他窗体。Main仍普通NSWindow、默认不置顶；不增加绑定或手改生成文件。

恢复局部基线41项及原生/前端通过，修改后cargo fmt、release check、Pin/权限回归及版本JSON格式通过。初次原生编译发现API需unsafe块，已修正并重跑通过。准备alpha.50完整构建；实际新包全屏/关闭重开/播放待验，未关闭U21父项。测试临时Pin及窗口大小已恢复。

原生实验采用同机AppKit，不替代实际Tauri应用验收；新包验证会另记。原完整中文/界面与审计/跨平台任务、严格解码15通过/2失败和MP4运行间差异均保留。
