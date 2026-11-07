# alpha.92：中文化/本土化批次实际包验收

版本 0.2.0-alpha.92／2026.92.0，冻结提交 161983d，候选标签 `next-v0.2.0-alpha.92-candidate`。本包把第 21 轮源码批次的 36 处文案本地化带入实际包，并在中英两种界面下核对已修复文案。

## 构建与安装

- `APPLE_SIGNING_IDENTITY=- node scripts/jianku.mjs release` 退出 0；源／归档（`Jianku Screen Next Builds/0.2.0-alpha.92`）／暂存／安装后三处严格验签、版本与六个可执行文件哈希一致。
- 安装 alpha.92，alpha.91 保留为回滚（`/Applications/.jianku-next-update92-*/previous.app`）；清理过期 update91（previous 90）。

## 界面核对

语言通过应用持久化的 `interface_language` store 切换（与 `setInterfaceLanguage` 写入同源），核验后已恢复 zh-CN。自定义语言下拉的选项未暴露给 AX，因此没有逐项点击 UI 菜单；这是本轮方法限制。

| 语言 | 页面 | 观察到的文案 |
| --- | --- | --- |
| English | 首页 | `Open project`、`System audio Off`、`New captures use this setting`、`Settings` |
| English | 设置 | 标题 `Jianku Screen Next · Settings`；侧栏 General／Recording quality／Hotkeys／CLI／Recordings／Screenshots／Automations／Transcription／Integrations／Account and services／Experimental／Feedback；General 页出现 `Language` |
| English | 快捷键 | `Editor shortcuts` 标题与说明 `These shortcuts apply in the editor. Changes are saved separately for each preset.` |
| English | 反馈 | `Screen Capture:` 与 `Supported` |
| 中文 | 首页 | `打开工程`、`系统声音 已关闭`、`新捕获使用此设置`、`应用设置` |
| 中文 | 快捷键 | `编辑器快捷键` 与说明 `仅在编辑器内生效。每套预设分别保留你的改键。` |
| 中文 | 反馈 | `捕获支持` 与 `支持` |

- 中英切换后文案即时切换，不需要重启；布局与控件无异常。恢复中文后再次打开设置与首页均正常。

## 未覆盖

- 当前账户为 Pro 升级门控，集成页只显示 `Upgrade to Pro`，未渲染 Google Drive／S3 的 `Not connected`／`Configure`／`Managed by your organization` 等本轮改动；`Not Supported`（录屏权限可用）、`Failed to fetch changelog`（未构造网络失败）、`item/items`（转写提示为空）、权限引导（权限已授予）同样未在本轮界面出现，仍需对应条件下复核。
- 语言下拉 UI 的逐项点击未验证；其余页面与动态字符串未逐面核对。U07/U08 父项不关闭。
- 未使用用户真实工程与真实录制。

## 证据文件

- `localization-ui-summary.json`：中英界面实际观察到的文案、未呈现项与切换方法。
- `package-source.json`／`package-archive.json`／`package-installed.json`／`rollback-installed.json`／`prepare.log`／`install.log`／`release.log.gz`：构建与安装证据。
- `store-zh-before.json`：切换前语言偏好（zh-CN）。
- `package92.py`／`verify-package.py`／`ui-drive.swift`／`ax-all.swift`：打包、验签与界面自动化工具。
