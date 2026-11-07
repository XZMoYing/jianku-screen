# 本地诊断报告生成与设备探测超时实包验收（alpha.99，U10b3b）

安装版 alpha.99。从「设置 → 反馈 → 开始诊断」真实走一遍本地诊断报告流程，核对设备探测卡住问题是否已被隔离/超时控制，以及报告是否可正常生成。

## 流程与结果

1. 打开设置 → 反馈，点击**开始诊断**，确认对话框「开始运行诊断？」点击**开始诊断**。
2. 因本应用无屏幕录制权限：UI 提示「无法运行同步测试：请在系统设置中为简库镜传开启屏幕录制权限…报告中仍包含系统信息」，同步测试被**安全跳过**。
3. 约**5 秒内**生成报告文件（`diagnostics/cap-diagnostic-20261108-044242.json`，4263 B，schema 含 app/hardware/system/permissions/audioDeviceProbe/audioOutputs/microphones/cameras/displays/storage/settings/matrixHints/syncTestError/recentRecordings 等）；UI 未卡死。
4. 报告关键字段（脱敏摘要）：
   - `audioDeviceProbe = "timed_out"`（CoreAudio 枚举在本环境仍可能卡住，但被 4s 超时隔离，报告不再阻塞）；
   - `permissions = {accessibility: denied, screenRecording: denied, camera: not_requested, microphone: not_requested}`；
   - `syncTestError = "Screen recording permission is required to run the sync test."`；
   - cameras 1 项、microphones/audioOutputs 为空（探测超时）。
5. 「显示文件」按钮 AXPress 成功；随后前台应用为应用自身/通知中心，未能在应用窗口工具中确认 Finder 最终定位（未截屏核验），记为未完全验证。

## 结论

- U10b3b（本地报告设备探测卡住）的隔离线程 + 4 秒超时控制在实际包生效：即使 `audioDeviceProbe` 仍 `timed_out`，报告也在约 5 秒内生成、UI 不阻塞；同步测试因权限缺失被安全跳过。**U10b3b 关闭**。
- 同步数值仍需屏幕录制权限（U10b3b3，TCC 无本应用条目，未改系统权限）。

## 未覆盖

- 屏幕录制权限授予后的同步数值（U10b3b3）；「显示文件」在 Finder 的最终定位；历史上传/日志边界（U10b3/U10b）；不同硬件/权限组合；未复制完整报告内容到仓库（仅脱敏摘要）。

## 证据文件

- `local-diagnostic-summary.json`：报告路径/大小/生成时间、关键脱敏字段、流程与结论。
- `ui-drive.swift`：新增 click-screen 等界面自动化源码。
