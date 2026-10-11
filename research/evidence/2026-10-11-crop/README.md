# 0.1.4 画面裁切验证

日期：2026-10-11。基础提交 d2dd259e057da01d75212b8ef2be29db778310b1；本轮改动指纹见 verification.json。

- ctest.log：18/18 回归通过。final-related-ctest.log：导出尺寸标签最后修改后的工程/导出两组回归通过。
- crop-ui-result.json：原生 Qt 窗口中的角点与整体拖动、像素输入、确认、Esc、撤销、1100×680 确认按钮位置、裁切预览、原始坐标逆映射、焦点定位和保存通过。
- metal-crop-*.png：实际 IOSurface → CVMetalTexture → QSG 原生纹理，先取蓝色右半，再在不发布新帧时改取绿色左半；两个取样区域均填满正方形窗口。测试不依赖屏幕采集授权，不代替实机来源验收。
- focus-regression-result.json：既有创建/裁剪/移动焦点、键盘复制粘贴、位置面板和画布定位通过。
- real-record-copy-result.json：用户真实录制的隔离副本首帧、播放、快速定位、外观和编辑保存通过；不收录该录制的画面、声音或媒体。
- 实际 H.264 裁切导出由 ExportControllerTests 运行：红蓝分半源画面保留蓝色半幅，120 帧、80×90、每帧颜色全部验证；原始解码尺寸保留 320×180。
- package.log、signature.txt：Release 0.1.4、随包媒体工具、Qt 依赖、DMG、稳定签名通过。离屏平台隔离检查的 Abort trap 是脚本预期行为，仅证明依赖能解析到 Qt 枚举平台插件；实际 Cocoa 窗口另行检查。
- native-window-check.json：实际打开的版本和可见窗口。用户试用为独立 0.1.4 工程，0.1.3 的应用未结束或覆盖。

调试入口：BUILD_TESTING=ON 的应用使用 --verify-editor PROJECT --verification-output DIR --verify-crop；焦点回归用 --verify-focus。Release 不包含这些入口。合成工程由 tests/create_editor_fixture.py 创建；本轮源尺寸 960×600、5 秒。

本轮实际界面检查发现并修复了保留属性名导致的加载失败、参数等待时误报就绪/旧任务覆盖、确认按钮被时间线遮挡、文本框 Esc 未取消的问题。最终通过记录是 crop-ui-result.json，不使用前几次失败记录作为通过证据。调试退出时的 QObject::disconnect 空参数警告仍出现在日志，列入交接。

原生录制/截图权限闭环、长素材、多屏/会议、实时完整模糊与百分之百动画一致尚未验收。摄像头、内容图层等完整范围没有因本子阶段完成而删减；全部待验证项集中在 docs/待验证项目交接.md。
