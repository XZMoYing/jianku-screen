# 自然运镜：U18b 曲线与关键帧组件

日期：2026-10-28。当前安装版仍为 alpha.38，本项是源代码和组件验收，尚未交付包含本项的新应用包。前一组件为 [U18a 透视运动模糊](../2026-10-27-3d-motion/README.md)，基线源码 `1ee86dcc401d08498eeb8539285d0039cae5c61f`。

## 曲线依据与行为

普通缩放使用解析弹簧，原 3D 模板则明确写入线性关键帧。直接把弹簧的阶跃响应拉到整个长镜头，会过早到位并留下较长静止时间；本项采用同一求解器追随匀速目标，再让弹簧归静。

计算读取 `ScreenMovementSpring::default()`：刚度 200、阻尼 40、质量 2.25。沿用普通缩放的 8 ms 密度，以默认 4 秒镜头为基准，齐次残差初值为阻尼/刚度、初速度 -1；目标匀速移动后停止，求解到归静。物理采样的位置和速度用 Hermite 插值，整条曲线再规范化到 0～1。镜头变长、变短或变速时等比重定时，形状保持，分割后的两部分能够保持原有速度。项目内另外调整的弹簧参数不会自动重写已有 3D 曲线；本项依据是默认配置。

新镜头、运镜模板、角度模板和自动场景默认使用“自然运镜”。旧项目仍读取原来明确的线性/Bezier；在 3D 面板的“动效风格”可主动切换。自然运镜在关键帧的 `outSpring.range` 中保存进度范围，中性 Bezier handles 仅作兼容数据；选择“线性”会清除此字段，菜单识别也独立判断，避免误把明确线性显示成自然运镜。

分割、重复裁切和中段删除保留各段曲线进度；同一时刻有不同值的内部切点视为实际切换，运动模糊不跨该点采样。固定焦外、光标、普通缩放和全部画面设置保持。

## 实际证据

- 渲染库 **341 通过、0 失败、6 项原有忽略**，包含端点/速度、分割/反向进度、连续裁切/重定时及内部切点检查。忽略项未计作通过；原两个严格硬件解码色度失败属于另一个检查集，本项没有关闭或放宽它们。
- 前端 **121 项通过**。覆盖旧自定义数据不变、明确线性切换、分割后的姿态/速度、再变速、连续裁切和中段删除。Rust 实际生成的 **2424 个采样点**经真实前端 `sampleTrack` 核对，归一化值采用 `1e-11` 数值精度；它不是放宽既有图像字节对照的阈值。
- `cap-project`、`cap-rendering`、`cap-recording` release 编译，渲染库 Clippy `-D warnings`、格式、TypeScript 与完整静态前端构建通过。`tauri.ts` 通过桌面原生 `typescript_bindings_tests::export_typescript_bindings` 实际生成，只增加新字段及类型，未手工修改生成结果。
- 新旧 CLI 在 12 个独立九秒合成工程上完成 **24 次实际 GPU 导出**，均最高质量、1280×720/60fps、540 帧并完整解码。七组旧配置 **3780 帧逐字节相同**；五组自然运镜按预期变化，全部音频 PCM 相同。自然运镜的清晰路径在分割前后 **540 帧完全相同**。总计 13 个成片对照全部通过，结果真源为 `export-comparison.json`；每个成片的逐帧指纹单独压缩保存。

旧 CLI SHA-256 为 `546968307eb2c859665b8b413fe47724e1c445c18fca4215eb19d09917769cef`；新 CLI 为 `4efc6e131b26b023ed31efd0ddda01d2e310cb48acd8592b938bbe07c83e2994`。原始输入及源文件指纹见 `inputs-manifest.json`，新旧执行器指纹另见 `before-runs.json` / `after-runs.json`。`inputs/` 保存实际使用的配置和元数据原字节压缩件，媒体未重复提交。

`natural-frames.png` 左列为线性、右列为自然运镜，三行分别为第 70、240、450 帧。完整本机并排短片为 `/private/tmp/jianku-3d-spring/natural-before-after.mp4`；完整原版和新片仍在该目录的 `fixtures/`。截图可以核对位置和边缘，不能证明主观舒适度或实际 GUI 帧率。既有 Glide Across 在两版都呈明显近景、部分越界；其姿态参数和缩略卡/成片比例仍需在 U18c 核对，尚未判断是否为预设设计意图。

## 边界与中途记录

实验 GPUI 是独立工作区，不在当前 Solid/Tauri 应用的打包路径中。共享类型的构造器及相位裁切辅助已接线；其 scoped offline check 被既有本地 `next/zed-cap/crates/gpui` 缺失阻断，详见 `gpui-check.log.gz`。没有恢复体积庞大的旧依赖，不能声称此实验界面已通过构建或完整适配。

中途发现并修复了新类型缺少 `PartialEq`、自然与线性中性 handles 识别冲突、尚未生成原生参考文件，以及新建端点测试对浮点末位使用严格相等的问题；旧线性默认断言也按新行为更新，同时保留低层线性/自定义回归。相关初始日志保留。第一次用 Bun 显式指定 tsconfig 后在进程退出时出现其 directory mismatch 提示，脚本已完成；普通应用目录调用验证了导入及拒绝覆盖，后续重跑使用下面的普通入口。另一次保护检查写错相对路径，在复制前中止，修正后检查通过。

本项没有把默认单跨度结果推广到所有导入的多段 Bezier/焦外关键帧裁切，未验证所有投影极值、GUI 持续显示、目标平台或物理设备。现有缩略卡的 hover 是界面过渡，不能代替成片中的相机轨迹验证。导出观察耗时混有启动、编码和检查负载，不作为速度提升基准。

## 重跑

在 `next/cap/apps/desktop/` 使用普通 Bun 入口生成新目录：

```sh
bun ../../../verification/2026-10-28-3d-spring/make-fixtures.ts \
  --source /private/tmp/jianku-3d-final \
  --directory /private/tmp/jianku-3d-spring-rerun
```

然后在 `next/cap/` 设置当前平台的原生库环境，分别运行原版、新版，并比较：

```sh
export DYLD_LIBRARY_PATH="$PWD/target/native-deps/lib:$PWD/target/native-deps/onnxruntime/lib"
python3 ../verification/2026-10-28-3d-spring/run-exports.py /private/tmp/jianku-3d-spring-rerun \
  --cli /private/tmp/jianku-3d-spring/before-cli --phase before
python3 ../verification/2026-10-28-3d-spring/run-exports.py /private/tmp/jianku-3d-spring-rerun \
  --cli "$PWD/target/release/cap" --phase after
python3 ../verification/2026-10-28-3d-spring/analyze-exports.py /private/tmp/jianku-3d-spring-rerun
```

基底是 U18a 的合成素材，缺失时不能声称已复现本轮原始结果；脚本拒绝覆盖。要复现历史数据，应检出本检查点，或恢复本目录保存的实际输入；生成器调用当前产品模板，未来模板改变会影响新生成的自然镜头。

原生参考由 `JIANKU_GENERATE_CAMERA3D_SPRING=1 cargo test --locked --release -p cap-rendering --lib camera3d_spring::tests::shared_reference_comes_from_the_existing_zoom_spring_solver -- --exact` 生成。正常回归不设置该变量，以免把变化误存为新期望值。前端只载入小型残差表，2424 点参考留在 Rust 的 test-data 中。

下一项 U18c：生成可试用包，在实际编辑器检查新建/切换/保存重开、包内导出和播放，再复核预设构图、曲线与模糊组合及性能。整体观感仍待用户确认；父项 U18 未关闭。
