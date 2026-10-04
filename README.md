# 简库镜传 · Jianku Screen

macOS 录屏与实时演示工具。录制画面经由**指针平滑、自动/手动焦点缩放、画面包装与动态模糊**处理，
输出成片；同一套外观定义也用于实时演示输出（第二屏 / 会议软件可选的共享窗口）。

> 开发中。当前可用的是一条完整链路：录制 → 离线合成 → 导出；时间线编辑（裁剪/切分/变速）已可用。
> 尚未完成的部分见文末「现状」。

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

指针与镜头的动画按参考实现固定版本 1:1 复刻，逐项参数与依据记录在
[`research/`](research/README.md)，其中包括半隐式 Euler 求解器、条件弹簧
（临近点击 / 拖拽 / 默认三档）、点击前瞻与缩放反馈、指针旋转、隐藏与淡出，
以及动态模糊的通道选择、采样核与父层运动扣除。

## 现状

**已可用**：采集三种来源、指针与光标落盘、暂停/继续、崩溃后文件仍可读、
离线合成（指针 + 镜头 + 画布包装 + 动态模糊 + 麦克风混音）、导出分辨率与帧率可选、
非破坏性时间线（裁剪 / 切分 / 删除 / 变速 / 撤销重做）及其界面。

**尚未完成**：摄像头画中画、字幕、快捷键显示、点击音效、背景音乐、
演示模式的实时合成输出、Windows 采集适配器。

**待验证**：动画观感（指针平滑度、点击反馈、镜头跟随、动态模糊强度）需要与参考成片逐帧对照；
动态模糊的位移上限、圆角单位等若干数值目前是基于静态证据的选择而非实测结论，
详见 [`docs/待验证项目交接.md`](docs/待验证项目交接.md) 与
[`.dsh/unattended/queue.md`](.dsh/unattended/queue.md)。

## 许可

私有项目，未授予任何许可。
