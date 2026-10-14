# scrcpy 安卓录制参数核查

采集日期：2026-10-14。参考版本：v4.1，与本机可执行程序版本一致。下列原文及源码用于离线核查，保持原文，许可见 LICENSE。

- [视频说明](https://github.com/Genymobile/scrcpy/blob/v4.1/doc/video.md)：尺寸上限、码率、帧率及捕获方向。
- [录制说明](https://github.com/Genymobile/scrcpy/blob/v4.1/doc/recording.md)：设备编码流、时间戳和本地容器。
- [ScreenCapture.java](https://github.com/Genymobile/scrcpy/blob/v4.1/server/src/main/java/com/genymobile/scrcpy/video/ScreenCapture.java)：首次把 LockedInitial 转成固定方向值；后续重建捕获使用同一方向。
- [recorder.c](https://github.com/Genymobile/scrcpy/blob/v4.1/app/src/recorder.c)：初始编码信息、MP4/MKV 方向矩阵和后续编码配置包。

当前编辑器按初始源画幅布局。基于上述实现，安卓新录制采用固定捕获方向，不使用录制容器中的单独旋转矩阵；避免用固定编辑布局解释中途变化的画幅。这是本项目的稳定录制策略，不表示已完成动态画幅分段或所有物理旋转验收。

设置尺寸是长边上限，不是固定 16:9 输出，也不主动放大来源。帧率是上限，设备画面静止时仍使用可变帧率；不通过重复采集投屏窗口补帧。MI 6 的专用连接条件保留，其他机型不使用该分支。本阶段不修改手机应用、网络或系统自动旋转设置。

## macOS 静止画面启动核查

`main.c` 只在 Windows 下关闭 stdout 缓冲；`util/log.c` 把 INFO 写入 stdout；`recorder.c` 在容器初始化后输出开始事件。以普通管道启动 macOS 进程时，短输出可能尚未送到父进程。应用对安卓 stdout 使用伪终端，stdin 和 stderr 保持独立；SIGINT 仍只发给本应用拥有的录制进程。启动超时只用于尚未确认开始的阶段，不能把正在录制的静止画面再当作启动失败。

MI 6 的短实录另发现：设备静止时媒体最终时间戳明显短于实际录制计时。`SurfaceEncoder.java` 具有重复上一帧参数，但该设备没有持续产生覆盖整个静止尾段的时间戳。原始文件仍保留；静止尾段延时/恢复属于后续独立修复项，本阶段不把工作流通过等同于所有录制时长通过。
