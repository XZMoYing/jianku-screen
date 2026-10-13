# 实时演示验证 · 0.2.0-alpha.7

最终试用包已实际运行：macOS 显示器捕获进入已有 GPU 合成器，独立输出窗口连接并确认收到画面。开始、实时改留白、焦点切换、停止与立即重启闭环通过；没有保存真实屏幕图像或声音。

入口为 [verification.json](verification.json)。最终结果在 [native-smoke.json](native-smoke.json)、[窗口及帧通道日志](delivery-viewer-evidence.log)、[短时计时](delivery-performance.json) 和 [窗口尺寸](delivery-windows.json)。计时仅表示调试包局部短测试；最终运行与后台原生检查并行，帧率有波动，不据此承诺完整场景满帧。

28 项相关测试通过；绑定由既有 Rust 测试生成。离线渲染修改前后的自建素材 360 帧完整 RGBA 和时间戳一致，见 [对照结果](offline-comparison.json)。测试视频位于仓库外，源素材及旧工程保留。

原生编译、打包已完成；包装器签名步骤发现 Spacedrive 框架容器未签名。已对同一个最终包补签并严格验证源包和试用副本。构建脚本按内到外签框架容器及应用，避免递归签名把中断临时文件封入包；这不是 Apple 公证。失败及恢复日志都保留。

较早的 `native-render-only-smoke.json` 只证明捕获/合成，当时界面路由未登记；`native-viewer-restart-failure.json` 证明窗口接通后发现快速重启竞态。最终包已修复两项问题。历史日志、签名失败与恢复文件用于追溯，不表示最终包仍处于该失败状态。

未完成的参考观感、实际快捷键、多屏、会议接收端、长时间性能和其他平台验收统一见 [待验证交接](../../../docs/待验证项目交接.md)。
