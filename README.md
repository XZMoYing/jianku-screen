# 简库镜传 · Jianku Screen

当前阶段为 `0.2.0-alpha.37`：补齐动态轨道、3D 镜头与加载界面的中文，修正构建链路由解析错误，并区分准备预览测试的解码配置。保留全部视觉效果，实际中文界面、完整导出及当前/上一版回滚已核对；另有两项 AVAssetReader 画面差异继续待办。见 [alpha.37 记录](next/verification/2026-10-26-alpha37-localization-preview/README.md)。2026-10-27 已用独立程序进一步定位到内置 FFmpeg VideoToolbox 解码的色度差异，严格失败仍保留；应用继续 alpha.37，见 [解码调查](next/verification/2026-10-27-decoder-parity/README.md)。下方早期说明保留作历史参考。

macOS 录屏与实时演示工具。录制画面经由**指针平滑、自动/手动焦点缩放、画面包装与动态模糊**处理，
输出成片；同一套外观定义也用于实时演示输出（第二屏 / 会议软件可选的共享窗口）。

> 新版已在 `rewrite/cap-foundation` 分支启动，基于 Cap 的 Rust / wgpu / Tauri / Solid 底座。新版入口与构建说明见 [next/README](next/README.md)，阶段范围见 [新版重构路线](docs/新版重构路线.md)。已进入 0.2.0-alpha.4 光标目标时间与收尾校准阶段；运行和导出证据见各阶段记录。实时演示、完整参考动画对照和编辑交互验收仍待完成。
>
> 下方保留旧 Qt 0.1.6 的说明。完整源码备份为标签 `backup-qt-0.1.6-20261011` 和远端分支 `backup/qt-0.1.6-2026-10-11`；旧目录与用户工程保留。

## 技术栈

- **C++20 + Qt 6.11 Quick/QML**，QML 用 Metal 渲染背景与前景。
- **原生媒体适配**：ScreenCaptureKit 采集（显示器 / 窗口 / 区域），AVAssetWriter 写入 H.264，
  CoreAudio 采麦克风，CGEventTap 记录指针事件与光标外形。
- **FFmpeg** 负责离线合成的解码、封装与音频混流。

## 构建

需要 macOS 14+、Qt 6.7+（开发用 6.11.2）、CMake 3.24+、ffmpeg（`brew install ffmpeg`）。

```sh
cmake -B build -DCMAKE_PREFIX_PATH="$(brew --prefix qt)"
cmake --build build -j8
./build/Jianku\ Screen.app/Contents/MacOS/Jianku\ Screen
```

运行测试：

```sh
cd build && ctest --output-on-failure
```

冒烟测试默认跳过需要真实录制工程的用例；想让它一起跑，传入一个工程目录：

```sh
cmake -B build -DJIANKU_SMOKE_PROJECT="/path/to/recording.jianku"
```

## 打包 DMG

```sh
cmake -B build-release -DCMAKE_BUILD_TYPE=Release -DCMAKE_PREFIX_PATH="$(brew --prefix qt)"
cmake --build build-release -j8
./scripts/package-dmg.sh          # 产物：build-release/简库镜传 <日期>.dmg
```

脚本会把 Qt 框架、QML 模块和 **ffmpeg/ffprobe 及其整个动态库闭包**塞进 app 包，把
install name 全部改成包内相对路径，然后 ad-hoc 签名、生成 DMG，最后**在屏蔽 Homebrew 的
环境里真正启动一次**——只在这台机器上能跑的东西会在这一步失败，而不是在别人的机器上。

两点务必知道：

- **没有 Developer ID 签名和公证**（需要付费开发者账号）。首次打开会被 Gatekeeper 拦下，
  需要右键 → 打开，或在「系统设置 → 隐私与安全性」里点「仍要打开」。
- 打包后的 app **优先使用包内的 ffmpeg**，其次才是 PATH 上的；所以用户不需要装 ffmpeg。

## 权限

应用需要**屏幕录制**、**输入监控**（指针轨迹）与**麦克风**权限。首次启动会引导开启；
重新编译会改变签名，可能需要在系统设置里重新授权。

从终端直接启动时，TCC 会把权限记在**终端**名下而不是应用本身，
所以权限排查请始终从访达或 Dock 启动应用，否则看到的授权状态是终端的。

## 结构

```
src/animation/   弹簧求解器、指针引擎、自动焦点、实时驱动
src/capture/     采集来源描述与几何、帧存储、时钟折叠
src/mac/         原生适配：ScreenCaptureKit、AVAssetWriter、CGEventTap、麦克风
src/render/      画布布局与绘制、离线合成器、动态模糊、导出与时间线控制器
src/project/     工程时间轴与编辑时间线
src/settings/    设置存储、背景库、显示器列表、品牌资源
ui/              QML 界面
tests/           CTest 用例（纯 main() + require()，无框架）
```

工程文件为 `.jianku/` 目录：`project.json` 清单、`raw.mp4` 原始画面、
`video-frames.jsonl` 逐帧时间轴、`pointer-events.jsonl` / `pointer-timeline.jsonl` 指针事件、
`cursor-observations.jsonl` / `cursor-timeline.jsonl` 光标外形观测、
`cursors.json` + `cursors/*.png` 光标资源、`automatic-zooms.json` 自动缩放区间、
`microphone.m4a` 麦克风轨。

## 动画模型

指针与镜头的动画以固定参考版本的百分之百复现为硬性目标，尚未完成逐帧一致验收。逐项参数与依据记录在
[`research/`](research/README.md)，其中包括半隐式 Euler 求解器、条件弹簧
（临近点击 / 拖拽 / 默认三档）、点击前瞻与缩放反馈、指针旋转、隐藏与淡出，
以及动态模糊的通道选择、采样核与父层运动扣除。

## 现状

**已接入并通过编辑/导出回归**：原始画面与独立事件轨合成、指针与镜头动画、画布包装、动态模糊、音轨混合、可选分辨率/帧率、真实缩略图/波形、片段选择/裁剪/重排/变速、自动/手动焦点、画面裁切、统一撤销与自动保存。

预览使用原生媒体时钟同步画面、声音和动画；缩放取样与合成在后台运行，Qt 场景图负责显示。动态模糊复用工作线程，保留既有采样、权重、透明边缘和动画参数，预览分辨率仍为 540p。可重复测试与本机对比见 `research/evidence/2026-10-11-preview/`。

**继续开发**：摄像头、贴图/遮挡/柔化、高亮、开场、逐片段声音、字幕/快捷键/音乐、完整导入/导出/分享工作流与 Windows 适配。演示的基础画布和因果聚焦已接入，实时 GPU 动态模糊仍需实现与验收。

**待验证**：原生截图/录制结束与权限实机闭环、动画逐帧一致、多屏/会议共享、长素材稳定性和全部边界集中在 [待验证项目交接](docs/待验证项目交接.md)；完整实施范围见 [编辑器功能台账](docs/编辑器完整功能对齐.md)。阶段完成不等于全部功能或百分之百动画目标达成。

## 许可

旧 Qt 代码未授予公共许可。新版 `next/cap/` 遵循其原始 AGPLv3 及例外授权；具体范围见 [上游许可证](next/cap/LICENSE) 和 [新版来源与修改声明](next/cap/JIANKU-NOTICE.md)。旧版声明不覆盖或变更上游开源代码的授权。
