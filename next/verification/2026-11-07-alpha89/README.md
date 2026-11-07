# alpha.89：诊断报告使用实际安装包版本

版本 0.2.0-alpha.89／2026.89.0，冻结提交 fe73a74，候选标签 `next-v0.2.0-alpha.89-candidate`。本包只含一项源码修复：诊断报告的 `app.version` 由 `env!("CARGO_PKG_VERSION")`（上游 Cap 的 0.6.0）改为 Tauri 打包版本（`app.package_info().version`）。

## 构建与验签

- 源码修复提交 28254a9；窄检查 `cargo fmt --all`、`cargo check --locked --release -p cap-desktop` 通过（1 分 06 秒）。
- `APPLE_SIGNING_IDENTITY=- node scripts/jianku.mjs release` 退出 0；本轮未再遇到钥匙串锁定（上一轮 alpha.88 的失败已记录）。
- `package89.py prepare`：源 bundle、归档副本（`Jianku Screen Next Builds/0.2.0-alpha.89`）、/Applications 暂存副本严格验签、版本一致、六个可执行文件哈希相同；已安装 alpha.88 与归档 alpha.88 六文件哈希一致，作为回滚基准。
- `package89.py install`：安装 89，alpha.88 保留在 `/Applications/.jianku-next-update89-*/previous.app`。

## 实际窗口验证

- 启动 alpha.89，打开自有合成工程副本（`复验（87诊断）.jks`），经托盘「本机诊断」运行诊断并确认。
- 新报告 `cap-diagnostic-20261107-201505.json`：`app.version = "0.2.0-alpha.89"`（修复前同一入口为 `0.6.0`）。其余字段与 alpha.88 一致：`permissions.screenRecording=denied`、`syncTest=null`、`syncTestError="Screen recording permission is required to run the sync test."`；界面出现「无法运行同步测试：」与「请在系统设置中为简库镜传开启屏幕录制权限，再运行音画同步测试。」。
- 隐私检查通过：设置无 recordingsPath／previousRecordingsPaths／serverUrl／instanceId，storage.recordingsPath 为 `[omitted]`，设备名称占位；报告检查脚本对显示／摄像头／麦克风／音频输出与近期录制分段字段逐项断言通过。
- 本次 `audioDeviceProbe=timed_out`（alpha.88 同入口曾为 complete），说明探测超时后报告仍继续；探测状态本身有运行间差异，未据此关闭 U10b3b。

## 未覆盖

- 音画偏移数值仍无：本机未给应用屏幕录制权限（TCC 无条目），需用户授权后实测（U10b3b3）。
- 本包不改变诊断收集范围、同步测试行为或界面其他部分；严格色度、播放时序、跨平台等门槛不变。

## 证据文件

- `package-source.json`／`package-archive.json`／`package-installed.json`／`rollback-installed.json`：四处路径、版本与六程序哈希。
- `release.log.gz`、`prepare.log`、`install.log`：构建、准备与安装输出。
- `report-results.json`／`report-summary.json`／`report-baseline.json`：报告检查结果与脱敏摘要（含 app.version）。
- `window-inspect.json`：诊断页界面文案检查。
- `package89.py`／`verify-package.py`／`check-report.py`／`diagnostics-ax.swift`：本轮打包、验签、报告校验与界面检查工具源码。
