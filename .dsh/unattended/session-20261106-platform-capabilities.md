# U12c 窗口过滤、截图 OCR、字幕平台边界

桌面在使用，保持 alpha.84，alpha.85 已验签暂存，原安装 journal 可继续，不构建第二个同版本。转做独立 U12c。确认窗口过滤选择只接 macOS，X11 窗口独立捕获与 Wayland portal 不接同一开关。Windows 是显示器 GraphicsCaptureItem 裁剪。首页纠正为 macOS 窗口录制才显示开关。

OCR 在 Mac 用 Vision、Windows 用 WinRT，Linux 无后端。截图预览只在支持的平台发请求，Linux 不新增 OCR 自动化模板或动作，已有规则显示跳过，原生能力列表与实际宿主一致。对照 Whisper／Parakeet 平台和 ONNX Runtime 装包，确认 alpha.85 Mac 归档有运行库。详细矩阵 `docs/跨平台能力与依赖矩阵.md`。桌面类型、20 项前端、格式和 macOS 桌面 release check 已通过。此源码晚于冻结 85，未入包。Windows/Linux 目标编译、语言和实际运行待验。

下一步若桌面空闲，先续已有 85 窗口验收；否则处理 U10a 转写内容日志。U12 父项和其他发布门槛保留。
