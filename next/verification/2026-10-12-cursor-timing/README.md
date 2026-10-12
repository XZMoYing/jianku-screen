# 光标目标时间与停止收尾验证（2026-10-12）

本阶段为 0.2.0-alpha.4 调试试用。校准普通位置目标的时间与缓存收尾，保留点击前瞻、上游位置解析求解器、UV 单位、事件过滤、镜头和画面参数。结论与哈希见 [verification.json](verification.json)，全部未完成验收以 [交接清单](../../../docs/待验证项目交接.md) 为准。

## 依据与范围

依据已保存的 [动画差异研究](../../../research/2026-10-11-Cap-动画差异研究.md)及其定位清单。取消默认参数下约 149 毫秒的通用目标预读；500 毫秒点击目标前瞻及 175 毫秒条件切换保留。每步用旧目标/参数推进后，再设置当前目标与参数；整数样本序号换算时间，避免累计误差。

原缓存在最后移动后 300 毫秒结束，即使尚未静止也冻结输出。新缓存覆盖最后一次移动或点击，并继续收敛；最多缓存随后 20 秒。仍不静止的参数保存最终目标、参数与状态，使用保留的解析求解器按查询时刻继续计算，支持反向定位且无需无限增长缓存。

这仍未完成参考位置求解器、过滤、捕获单位、事件边界、首帧及变速后真实曲线的逐帧验收。姿态缓存尾部继续沿用先前实现；不得把本阶段位置检查当作所有动画已通过。

## 独立轨迹与 GPU 检查

`analytic-reference.py` 仅使用 Python 标准库的欠阻尼闭式方程，以 470/70/3、60 Hz 和 1 秒改变位置目标生成 181 步轨迹；不调用产品实现，不运行商业应用代码。对应 CSV 位于 `next/cap/crates/rendering/test-data/cursor-timing.csv`。它验证当前解析模型的时间更新，不是参考应用导出。

在 `next/cap` 目录：

```sh
python3 ../verification/2026-10-12-cursor-timing/analytic-reference.py > /tmp/cursor-timing.csv
cmp /tmp/cursor-timing.csv crates/rendering/test-data/cursor-timing.csv
cargo fmt --all --check
cargo check --locked -p cap-rendering -p cap-editor
cargo test --locked -p cap-rendering --lib cursor_interpolation -- --nocapture
cargo test --locked -p cap-rendering --lib overlay_layers::native_tests -- --nocapture
cargo test --locked -p cap-rendering --lib display_
cargo test --locked -p cap-editor --lib preview_cursor_cache
cargo test --locked -p cap-editor --lib raw_preview_cache
```

修改前在 0.9 秒已经从 x=0.1 移至约 0.2068；GPU 的操作前整帧出现 1360 个字节差异，停止/晚到点击/无阻尼缓存检查也失败。修改后验证普通目标、默认静止、晚到点击、无阻尼继续运动和反向定位；原生 Metal 验证整帧、直接/缓存、剪切重排、0.5×/2×、30/60/120 fps 和两种尺寸。

旧的“跟随不得落后”用例要求补偿效果，已改为检查所选弹簧的物理滞后，并用独立轨迹验证目标时间。已有线性查找对照保留，用于检查查找和缓存；共用时间步进以去除重复实现，不用该对照代替独立动画验证。最初新增 GPU 用例因借用和可变渲染器问题未编译，修正后才记录修改前实际失败；完整帧比较报告差异数，保持必须零差异的条件。

## 自建工程与实际输出

复制 `../2026-10-12-native-foundation/fixture.cap` 并覆盖本目录的 `fixture-overrides/`。素材是已归档的自建视频、PNG 与固定渐变，无用户捕获或桌面背景图片。源视频六秒、960×600 / 30 fps；光标从 `(0.1, 0.5)` 在 1 秒变为 `(0.9, 0.5)`，没有点击，保留 1.0–3.7 秒的 2× 偏侧缩放及画面配置。

原始光标对照只把 `cursor.raw` 设为 true。分别使用保留的 alpha.3 和最终 alpha.4 导出，视频在仓库外 `~/Movies/Jianku Screen Next/试用 0.2.0-alpha.4/`。完整解码、逐帧比较、签名和实际窗口证据随最终记录归档；不以 `open` 返回成功代替应用与帧送达检查。
