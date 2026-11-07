# alpha.88：同步诊断权限预检合包与实机验证

版本 0.2.0-alpha.88／2026.88.0，冻结提交 4a697bc，候选标签 `next-v0.2.0-alpha.88-candidate`。本包把 HEAD 上未打包的两项源码合入：同步失败阶段与固定错误类别（d12db5c）、macOS 同步测试录屏权限预检与中文提示（9811e08），并包含 b7c9bee/50f15f4 文档与测试提交。

结论：**权限不足路径在真实安装包与实际窗口中通过**——录屏权限为 denied 时诊断报告仍生成，报告记录安全的同步失败原因，界面显示中文提示；**音画偏移数值仍未取得**，因为系统未给本应用屏幕录制权限（TCC 无 `kTCCServiceScreenCapture` 条目），按授权边界本轮没有修改系统隐私设置。

## 构建与验签

- 第一次 `node scripts/jianku.mjs release` 在签名阶段超时：本机 `jianku-dev` 钥匙串处于锁定状态，codesign 触发钥匙串密码对话框（截图与对话框文本已确认，仅取消、未输入密码）。取消残留对话框后，以显式本地 ad-hoc 身份重跑：`APPLE_SIGNING_IDENTITY=- node scripts/jianku.mjs release`，退出 0，与既往阶段包签名方式一致（`Signature=adhoc`）。
- `package88.py prepare`：源 bundle、归档副本（`Jianku Screen Next Builds/0.2.0-alpha.88`）、/Applications 暂存副本严格验签与版本一致，六个可执行文件 SHA-256 相同；已安装 alpha.87 与归档 alpha.87 的六文件哈希一致，作为回滚基准写入 journal。
- `package88.py install`：先通过 AX 菜单「退出简库镜传 Next」正常退出应用，再把 87 移入 `/Applications/.jianku-next-update88-9wp_rn_w/previous.app`，安装 88 并复验六文件哈希。回滚副本仍在，可手工换回。

## 实际窗口与诊断

- 从应用包启动 alpha.88，打开自有合成工程副本 `复验（87诊断）.jks`（/private/tmp，非用户素材），经托盘「本机诊断」进入设置页，按「开始诊断」并在确认弹窗确认。
- 新报告 `cap-diagnostic-20261107-194926.json`：`permissions.screenRecording=denied`、`syncTest=null`、`syncTestError="Screen recording permission is required to run the sync test."`、`audioDeviceProbe=complete`。
- 界面无障碍树同时出现「无法运行同步测试：」和「请在系统设置中为简库镜传开启屏幕录制权限，再运行音画同步测试。」，证明安全阶段与本地化提示在真实包生效。
- 隐私检查通过：设置无 recordingsPath／previousRecordingsPaths／serverUrl／instanceId，storage.recordingsPath 为 `[omitted]`，显示／摄像头／麦克风／音频输出名称均为占位符，近期录制分段不含设备 ID。
- 本轮未见 alpha.87 的音频设备探测 `timed_out`：`audioDeviceProbe=complete`；只作为本次观察，不据此关闭探测专项。

## 未覆盖与阻塞（不静默豁免）

- **U10b3b3 数值未验**：需要用户先在「系统设置 → 隐私与安全性 → 屏幕录制」为本应用授权并重启应用，再运行诊断。应用为 ad-hoc 签名，每次重新打包可能使既有授权失效，需按用户授权的时机重新开启。本轮未修改 TCC，也未用其他带录屏权限的进程代测。
- **诊断报告版本字段**：报告 `app.version` 为 `0.6.0`（来自 `env!("CARGO_PKG_VERSION")`），不是安装包版本 `0.2.0-alpha.88`，无法从报告区分简库构建；记为 U10b3d 后续源码修复，本包不改。
- 未读取用户真实录制、未上传、未连接网络；严格色度、播放时序、跨平台等既有发布门槛不变。

## 证据文件

- `package-source.json`／`package-archive.json`／`package-installed.json`／`rollback-installed.json`：四处路径、版本与六个可执行文件哈希。
- `prepare.log`／`install.log`：打包准备与安装输出；`release1.log.gz`（钥匙串超时失败）与 `release2.log.gz`（ad-hoc 成功构建）保留失败与成功两侧。
- `report-results.json`／`report-summary.json`／`report-baseline.json`：报告检查结果、脱敏摘要与新报告基线；`window-inspect.json`：界面文案检查。
- `package88.py`／`verify-package.py`／`check-report.py`／`diagnostics-ax.swift`／`quit-app.swift`：本轮使用的打包、验签、报告校验、诊断界面与正常退出工具源码。
