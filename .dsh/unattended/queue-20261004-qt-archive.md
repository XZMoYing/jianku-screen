# 简库镜传｜无人值守推进队列

唯一真源。每轮只取「待办」的首项，做完勾掉并追一行结论。结论必须写清「改了什么 / 怎么验证 / 看到什么」。

- 项目根：`/Users/moyingxz/Documents/Zzx/05_项目开发/Jianku Screen`
- 验证命令：`cd build && cmake --build . -j8 && ctest --output-on-failure`
- 运行日志：`.dsh/unattended/`
- 上次更新：2026-10-04 07:30｜用户已回来，无人值守结束

> **本轮无人值守已于 2026-10-04 07:20 结束**（用户回来）。此后按用户在场的方式推进，
> 且已获授权：新建 GitHub 仓库并推送。远端：https://github.com/XZMoYing/jianku-screen

## 授权边界（本次无人值守）

可以：读改本地代码、跑构建与测试、本地 git 提交、写文档、写运行日志、读 `~/Movies` 下的录制工程。
不做（等用户回来决定）：`git push`、改 CI、装系统级软件、**修改或删除用户的录制素材**。
额外约束：本仓库为**私有本地仓库**，不做任何远端配置。

## 现状（2026-10-04 05:55）

- 构建：`cmake --build build -j8` 通过，warning 归零。
- 测试：`ctest` **15/15** 通过（timeline-boundaries、spring-solver、cursor-engine、
  auto-focus、media-clock、canvas-layout、capture-source、motion-blur、compositor、
  export-controller、canvas-renderer、edit-timeline、timeline-controller、
  timeline-geometry、timeline-strip）。
- 版本历史：基线 `85af2cd`；此后 21 个提交，均在本地。
- 本轮做了 11 件事，见 Q13–Q23。
- 权限：approval=never / danger-full-access，无人值守期间无审批阻塞。
- 工作区无其他执行体（Trae 停在 23:38，报的是模型侧 4054，不是代码错误）。

## 已完成

| # | 项 | 提交 | 验证 |
|---|---|---|---|
| Q1 | 暂停后停止产出损坏 MP4（无 moov atom） | `bee294b` | 用坏文件的真实时间戳做夹具，`media-clock` 单测把旧表达式钉成负向对照 |
| Q2 | `cursorSmoothing` / `clickEffect` 写了没人读 | `c1fad97` | `cursor-engine` 补设置映射断言；实测 None 预设从「仍然平滑」变为「吸附原始位置」 |
| Q3 | 画布布局三处各算各的 | `f3a7de4` | 新增 `canvas-layout` 单测（contain/padding/inset/退化输入/比例换算） |
| Q4 | 设置映射会被预览与合成器解释成两样 | `f3a7de4` | 抽出 `driverSettingsFromMap()`，两个读取方共用 |
| Q5 | 录制成片没有指针、没有镜头、没有画布包装 | `f7c9901` | 新增 `jianku-compose`，真实 124.66s 工程合成出 h264+aac；`--no-cursor` 差分定位到指针像素 |
| Q6 | 合成器长片导出被内核 OOM 杀掉 | `8b86a63` | 加写缓冲水位做背压；RSS 从 82GB 降到稳定 284MB |
| Q7 | `project.json` 的 `error` 字段语义混乱 | `8b86a63` | 成功写空串、失败写原因 |
| Q8 | 成片被 `-shortest` 静默裁短仍报成功 | `6eab3e4` | 加 ffprobe 回读校验；全片 7480 写入 / 7480 回读，完整解码无错 |
| Q9 | 合成器只有命令行入口 | `e6b80bc` | 新增 `export-controller-tests` 端到端跑真实管线；应用内可导出并可取消 |
| Q10 | 麦克风轨未并入成片 | `c082ccc` `a18c87c` | 互相关确认对齐偏移 13.2 ms、相关系数 0.994；顺带修掉 `"microphone": true` 的类型转换 bug |
| Q11 | 只有整屏来源 | `06aefdf` | 新增 `capture-source` 单测；实测窗口阴影会内缩内容 64px（必须关闭），区域映射无系统性偏移（用噪声基线对照证明） |
| Q12 | 动态模糊被整体回退 | `f1c9ac2` | 新增 `motion-blur` 单测；真实工程全片扫描 + 缩放过渡抽帧 |

## 待办（按顺序取首项；已完成项就地保留结论）

### Q8 合成器不校验成片帧数 ✅
结论：`-shortest` 会把已经合成好的视频裁到音轨长度。系统声音比视频早停
（124.533s vs 124.677s），7480 帧的合成结果实际只写出 7470 帧，程序仍报成功。
已去掉 `-shortest`，并新增回读校验：ffprobe `-count_packets` 数成片里真实视频包数，
与写入帧数不符就把整次合成标为失败。
验证：`--frames 300` 写入 300 / 回读 300；**全片 7480 帧写入 / 回读 7480**，
`ffmpeg -f null -` 完整解码一遍无错误，时长 124.667s，体积 37.8MB。
产物副本：`build/composed-demo-22-46-50-891.mp4`（build/ 已 gitignore，不入库）。

### Q9 合成器只有命令行入口，没接进 UI ✅
结论：新增 `src/render/ExportController.{h,cpp}`，把同步的 `composeProject()` 放到工作
线程，进度经队列信号回 QML；主工具栏加「导出成片」按钮 + 预览区底部进度条，
完成后自动在 Finder 定位产物。`ComposeOptions` 增加 `shouldCancel` 轮询
（取消不是失败，UI 不报错）。
顺带修掉一个真实环境问题：Finder 启动的应用只继承 `/usr/bin:/bin:/usr/sbin:/sbin`，
Homebrew 的 ffmpeg 按名字根本找不到；ffmpeg/ffprobe 定位抽成
`findFfmpeg()` / `findFfprobe()`。
验证：新增 `export-controller-tests` 端到端跑真实管线（ffmpeg 现造 30 帧源视频 →
控制器导出 → 回读成片确认 60 个输出帧）；空工程目录被拒绝而不是假装导出。
应用启动无 QML 报错。提交 `e6b80bc`。

### Q10 麦克风轨 `microphone.m4a` 未并入成片 ✅
结论：合成时按测得的偏移把麦克风混入。录制端在真正开始录音后打 host 时间戳写进
`project.json`；导出端用它与视频首帧的差作为常量偏移（两边折叠同样的暂停区间，
所以偏移全程不变）。麦克风晚于首帧用 `adelay` 推后，早于首帧用 `-ss` 裁掉开头。
`amix` 用 `normalize=0` 保持录制电平。只有系统声音时仍走 `-c:a copy` 不重编码。
**顺带查出一个一直存在的 bug**：`project.json` 里四个工程的 `microphone` 字段全是
`true`——`impl_->projectManifest.insert("microphone", [micRecorder metadata])` 把
NSDictionary 交给了 QJsonValue，重载解析落到指针转 bool。已加 `jsonFromDictionary()`
显式转换，加载端同时兼容新旧两种格式。
验证：真实工程成片音轨与源 `microphone.m4a` 互相关——最佳偏移 13.2 ms、
相关系数 0.994；`volumedetect` 确认混音后电平上升（-91.0 dB → -66.1 dB）。
提交 `c082ccc`、`a18c87c`。

### Q11 窗口与区域录制来源 ✅
结论：三种来源走同一条管线，只有 filter 与裁切不同。
- `src/capture/CaptureSource.{h,cpp}`：来源描述 + 几何解析，纯函数可单测。
  三种来源都归结为「全局点空间里的一个矩形，以已知像素尺寸录制」，指针记录器 /
  动画引擎 / 合成器都不分来源类型。像素尺寸取偶（H.264 4:2:0 不能编码奇数宽高）。
  区域按显示器裁切并如实记录裁切后矩形；窗口不裁切（SCK 交出整个窗口）。
- `PointerEventRecorder` 不再自己从 displayId 推包围盒，改由调用方传入实际录制矩形。
  否则窗口/区域录制里每个指针事件都会按整屏换算，位置全错。
- `MacCapture::startSource()` 统一入口；窗口用 `initWithDesktopIndependentWindow`
  （遮挡时仍产出自己的像素）。UI 加 屏幕/窗口/区域 选择与 `ui/RegionSelector.qml`
  （覆盖所有屏的并集，跨屏可拖）。

**两个实测出来的坑（都写了独立探针直接问 SCK，不是推断）：**
1. **窗口阴影必须在流配置里关掉。** 含阴影时帧尺寸仍是 `window.frame × scale`，
   但内容从 (64,49) px 才开始不透明（外圈 alpha 全 0）；关掉后从 (0,0) 铺满。
   不关的话「记录的矩形」和「帧里的内容」差一圈，指针事件全偏。
2. **区域映射没有系统性偏移。** 互相关一开始测出 ~6px 位移，看着像原点算错；
   做了噪声基线对照（两次全屏截图互比，真值 0,0，同一搜索也报 +5~+8px）后确认：
   那 6px 是桌面内容在两次采集之间自己变了。区域标称位相符率与噪声基线持平。

验证：`ctest` 9/9，新增 `capture-source`（几何/裁切/取偶/序列化往返/坐标映射，
含「用整屏包围盒换算会算错」的负向对照）；`compositor-tests` 增加 region 来源
manifest 的加载断言。应用启动无 QML 报错。提交 `06aefdf`。
证据：`.dsh/unattended/evidence/window-capture.png`。

### Q12 动态模糊 ✅（观感待用户验收）
结论：这次做成**离线逐帧纯函数**，不是上次那套实时 GLSL。逐条对着 3.7.5 静态
定位的渲染链写：通道二选一（尺寸变化严格大于中心位移才选 zoom）、选定变化
<1 px 不加滤镜、选中通道强度为 0 不退回另一通道、强度乘 fps/60、move kernel 21
单侧分布 `速度×i/20`、zoom kernel 13 权重 `4(p−p²)` + 稳定伪随机、父层运动扣除与
分轴反号清零。累加走浮点，避免弱样本舍入造成的暗边。

**两个实测出来的坑：**
1. **位移上限是必须的。** 静态笔记的两个阈值（1 与 0.01）差一百倍，说明强度乘子
   的单位没定死。按字面把速度当一帧位移用，真实录制 122.2s 处（相机快速回位，
   帧间位移 >200 px）整个画面糊成半透明、背景从画面中间透出来。加了显式上限
   `kMaximumSmearRatio`（对角线 0.3% ≈ 12 px）。**这是选择而非发现**，注释与这里
   都写明，等有参考输出帧对照再校准。
2. 打开模糊后 3360×2100 全片从 20.9 帧/秒掉到 1.5 帧/秒，并行化两个 pass 后
   仍属离线能力；实时预览要用它得另做优化，本次**不承诺**实时。

设置默认值补齐四个 motionBlur 键，设置页新增「动态模糊」面板（明细标注观感未对照），
CLI 加 `--motion-blur[-cursor|-move|-zoom]`。
验证：`ctest` 10/10，新增 `motion-blur`；真实工程全片扫描 move 209 / zoom 378 帧，
缩放过渡处 14–24% 像素变化。提交 `f1c9ac2`。
证据：`.dsh/unattended/evidence/motion-blur-zoom-{on,off}.png`。

**待用户验收**：这个上限值是我选的，不是量出来的。如果拖影看起来太弱/太强，
改 `src/render/MotionBlur.h` 里的 `kMaximumSmearRatio` 一处即可。

### Q13 画布包装（背景/留白/圆角/内框/阴影/背景模糊）三处各写一遍 ✅
结论：抽出 `src/render/CanvasRenderer.{h,cpp}`，与 `CanvasLayout` 的分工是
「Layout 只算几何，Renderer 管样式映射与绘制」。`canvasStyleFromMap()` 是
设置→样式的唯一入口，`planCanvas()` 是布局的唯一入口（画布固定时按画布算留白，
画布由内容长出来时按内容解同一个等式），绘制入口是
`drawCanvasBackdrop/beginFrame/drawInsetBorder/endFrame`。
**抽的理由是这三处此前真的不一致，而且是用户直接看得见的：**
- 快捷截图**只认纯色背景**。选了渐变或内置背景，预览是渐变，截出来的 PNG 是纯色。
- 留白的算法两边不同：预览按画布宽高各取百分比（非等比），合成器按画布短边取。
  同一个「留白 10%」，预览和成片的留白不一样宽。
- 圆角、内框、阴影只有合成器有，截图一个都没有。
验证：`ctest` 11/11，新增 `canvas-renderer`（留白两种解法的**比例**必须一致、
不同画布比例下来源不拉伸、渐变确实有渐变且方向正确、圆角/内框/阴影真的落到像素上、
退化输入不崩）。提交 `e8ca667`。

### Q14 预览在 QML 里自己重算布局与样式 ✅
结论：新增 `src/render/CanvasPreview.{h,cpp}` 暴露给 QML。几何以**画布比例**传出
而不是像素——预览窗口大小随窗口变，而布局按输出像素定义，保持比例才能让预览与
成片构图一致。QML 删掉自己算的 padding/圆角/内框/背景颜色读取，全部改读 plan。
**顺带修掉一处会看出来的不一致**：预览的渐变用 QML 的顺时针旋转，合成器用
`QLinearGradient` 的数学角度，同一个 135° 在两边镜像。测试里把约定钉住了
（135° 时起始色在右上，与预览一致）。背景模糊也只留一处比例映射。
验证：`ctest` 12/12；应用启动无 QML 报错。提交 `3c8af54`。

### Q15 动态模糊四个分项强度的默认值只有静态证据 ✅
结论：本机有 6 个参考软件已保存的工程（只读），它们的 `project.json` 全部是
`motionBlurAmount/CursorAmount/ScreenMoveAmount/ScreenZoomAmount = 1`，跨 11 天一致。
这是**落盘的有效配置**，比官方安装包里的静态基础对象强一档，独立支持了默认值。
同时确认：留白与圆角是**用户值**（每个工程都不同，且两者无固定比例，圆角/留白
从 0.15 到 0.38），所以不能拿任何一个工程当新工程默认。
验证：只读比对 6 个工程的 manifest，写进 `research/参考工程实测值.md`，
`research/README.md` 加索引。提交 `c8d96ea`。

### Q16 没有编辑时间线：裁剪/删除/变速无从表达 ✅
结论：新增 `src/project/EditTimeline.{h,cpp}` 纯模型 + 接进合成器。输出时间线是
若干片段的拼接，每段把 `sourceEnd-sourceStart` 的素材以 speed 播成
`(sourceEnd-sourceStart)/speed` 的输出时长；映射连续且严格单调，所以动画引擎在
素材时间步进、帧时钟跑在输出时间，两边不会错位。素材顺序不可重排（删一段是
「跳过」不是「搬前面」），加载与每次编辑后都校验，**失败不留改了一半的状态**。
`composeProject` 只认时间线——没剪辑时它就是一条恒等片段，导出只有一条代码路径。
CLI 加 `--cut/--speed/--trim-from/--trim-to`，按固定顺序（先变速、再删、后裁）应用，
参数意义不取决于敲命令的顺序；无效参数退出码 2。
验证：`ctest` 12/12，新增 `edit-timeline`（往返闭合与单调性是贯穿全文件的属性检查）。
真实 124.66s 工程实测：删 40–70s 后 94.66s，剪辑点前后映射正确；**逐帧比对确认
拼接正确**——剪辑点前一帧与原片第 29 帧相符 100%，当帧与原片第 90 帧相符 99.97%，
后一帧 99.98%。提交 `cb712e0`。

### Q17 编辑操作没有 UI 层（撤销/重做/段列表） ✅
结论：新增 `src/render/TimelineController.{h,cpp}`，算术仍全在 `EditTimeline`
（所以「什么叫一次剪辑」只有一份实现），这一层只加 UI 需要的：段列表、错误上报、
有界历史。两个出错了用户会丢工作的行为钉在测试里：**失败的操作什么都不改也不进
历史**（先应用到副本）、**成功才记一步**（撤销后再编辑清掉重做分支）。
顺带定了一个语义：`split` 只切段、内容没动，所以 `edited()` 问的是
`playsWholeRecording()`——切分是可撤销的一步，不是用户看得见的改动。
导出控制器接上时间线，`start()` 时拷贝，导出过程中再编辑不影响正在写的成片。
验证：`ctest` 13/13，新增 `timeline-controller`（加载与拒绝、操作与历史、
失败不改动、输出时间语义、空控制器）。提交 `fe14e8e`。

### Q18 录制中途被杀 → 整个文件报废（真实损坏案例） ✅
结论：`~/Movies` 里那个 `2026-10-03 23-27-15-049.jianku` 是真实损坏：
28.3MB 的 `raw.mp4`，顶层只有 `ftyp wide mdat`，`moov`/`moof`/`mfra`/`sidx` 全 0 次，
`state=failed`。因为索引是 `finishWriting` 才写的，进程没走到那一步，
**一个解码器都打不开**——不是丢最后几帧，是 28MB 全丢。

写了探针直接对比（`probe.mm`/`probe2.mm`/`probe3.mm` + QFile 三连）：
- 普通写法，MPEG-4 与 QuickTime 两种容器，被杀后**都完全打不开** → **换容器没用**。
- `movieFragmentInterval = 1s` 后被杀 → **可播**，时长正确；
  正常结束时也无副作用（`status=completed`、时长对、完整解码无错）。
- 只修视频不够：`video-frames.jsonl` 用 QFile 逐行写而 Qt 把数据留在用户态缓冲，
  实测写 100 行不 flush 直接退出 → **文件 0 行 0 字节**（工程仍然加载不了）。
  周期 flush 的代价可忽略（10 次 0.2ms），丢失量正好是最后一个 flush 周期。

改动：`MacCapture.mm` 加 `movieFragmentInterval = 1s`；
帧时间线每 60 帧强制 flush（与分片间隔对齐，两边丢的范围一致）；
`errorText()` 在 NSError 描述为空时退回 domain + code，
不再只记下 "The operation could not be completed"。
验证：`ctest` 13/13；用「被杀的分片文件」当素材跑完整合成——60 帧进 / 60 帧出 /
回读 60 / 时长 2.000s；真实录制重封装成分片后 ffprobe 读到 6.900s、360 包。
证据：`.dsh/unattended/evidence/fragmented-writer.md`。
**未做**：崩溃留下的工程现在视频可读但 `state` 仍是 `failed`，
要不要开机扫描修复需要先定行为，留给用户。那个已损坏的文件救不回来（只解析出 371KB），
也没有动它。

### Q19 时间线没有界面，编辑只能用命令行 ✅
结论：模型（Q16）与控制器（Q17）就绪后，把界面补上。
`src/render/TimelineGeometry.{h,cpp}` 是新的纯函数层：位置↔时间、帧吸附、
就近吸附到切点、刻度间隔与标签。**单独成层是因为这类算术错了不会崩，只会看起来
有点不对**（播放头差一像素到不了尾、切点落在两帧之间、标签跳到看不懂），
在 QML 里没法验，只能单测。
`TimelineController` 增加播放头与标尺，每次编辑后夹一次播放头（输出变短后它会越界）。
`ui/TimelineStrip.qml` 摆放标尺/片段条/播放头 + 切分/删除/撤销/重做/复原。
导出帧率改成 `ExportController.frameRate` 可写属性，而不是另立一个设置键——
播放头吸附用的帧率必须就是导出写出的帧率。

**新增 timeline-strip：把 QML 也纳入 ctest。** QML 绑定坏了不会加载失败，
只打一行 warning 然后渲染空白，这正是「时间线安静地什么都不显示」的成因；
所以测试实例化真的组件、接真的控制器，并把任何 QML 告警当失败。
搭这个测试踩到三个坑（都写进了注释）：测试进程导入不了应用的 QML 模块
（qmldir 指向只存在于应用二进制里的资源路径），要自己编一份模块，
而两个 QML 模块不能共用输出目录；`QT_RESOURCE_ALIAS` 必须在
`qt_add_qml_module` 之前设；`QCoreApplication` 会让 QML 引擎段错误，
必须 `QGuiApplication` 且设 Basic 样式。

验证：`ctest` **15/15**；应用启动无 QML 报错。

### Q20 时间线只能点按钮，不能拖 ✅
结论：首尾各加一个裁剪把手（拖到哪裁到哪），加 0.5×/1×/2×/4× 变速按钮。
变速作用于**播放头所在的片段**而不是整条时间线：剪辑后只影响指着的那段，
旁边的段仍走实时，否则一次变速会静默改动用户没指的内容。
把手报的是**输出时间**——素材时钟已被前面的剪辑平移过（测试钉住了这一点：
先裁头 2 秒，再「裁到 7 秒」得到素材 9 秒）。被拒绝的裁剪会明说原因，
把手拖了没反应又不提示，看起来就是坏的。

**这一轮最值得记的是一个测试局限。** 我原本以为 timeline-strip 能抓住
「绑定到不存在的属性」，于是故意改坏再跑——**Qt 6.11 对读取不存在的属性
根本不报警**，只求值成 undefined；只有调用不存在的**函数**并运行到才告警。
已把这条写进测试文件开头，免得后来的人高估它。

验证：ctest 15/15；另用真实工程把「删除 + 变速」两种剪辑叠加后逐帧核对——
5 个取样点里有 4 个与参照相符 99.99%、1 个 100%，映射与手推一致
（证据：`.dsh/unattended/evidence/fragmented-writer.md` 末节）。

### Q21 音量滑块完全不起作用（写了没人读） ✅
结论：设置页的「麦克风音量」「系统声音音量」与 `audioVolume` /
`systemAudioVolume` 两个键，**没有任何代码读**——`ComposeOptions` 有字段但始终是
1.0，拖动滑块对导出零影响。与之前 `cursorSmoothing` 同一类问题。
改法：在 `makeComposeContext` 里读并夹取到 [0,4]（负音量在 ffmpeg 里是反相
不是静音，夹取必须），`ComposeOptions` 改成 `-1 = 用工程值`（与 motionBlur 同约定），
CLI 加 `--system-volume` / `--microphone-volume`。
实测：麦克风改 0.25 后 mean_volume 从 -60.7 dB 降到 -72.8 dB
（-12.1 dB ≈ 0.25 倍的 -12.04 dB）。

**另一个查了但决定不接的**：`mouseClickSpring` 同样没人读，但已定位的参考调用链
写明 zoomer-and-fader 用的是它**自己**的弹簧（300/30/0.3），也就是引擎现在跑的值。
接上它像「修好一个没接线的设置」，实际与证据矛盾。没改，并加断言把
「故意忽略」钉住。

验证：ctest 15/15（compositor 新增音量映射与夹取断言）。

### Q22 设置项审计：还有哪些键写了没人读 ✅
结论：把 72 个设置键逐个搜引用方，结果分三类。
**只被设置界面引用的 21 个**：`audioVolume`（Q21 已修）、`mouseClickSpring`
（查证后决定不接）、以及摄像头（`cameraSize`/`cameraRoundness`/
`cameraScaleDuringZoom`/`cameraAspectRatio`/`hideCamera`/`mirrorCamera`）、
字幕（`showTranscript`/`transcriptSizeRatio`）、快捷键
（`showShortcuts`/`showShortcutsWithSingleLetters`/`shortcutsSizeRatio`）、
背景音乐与点击音（`backgroundAudioVolume`/`muteBackgroundAudio`/
`clickSoundEffectVolume`）、`playbackSpeed`、`alwaysKeepZoomedIn`、
`glideSpeed`、`improveMicrophoneAudio`、`muteExternalDeviceAudio`。
**这 20 个不是 bug，是尚未实现的功能**——摄像头、字幕、快捷键显示、
背景音乐、点击音效在队列里本来就列为「明确未做」。区别在于：Q21 那种
「本该生效却写死了」是缺陷，这些是缺失的功能，不该混为一谈。
**真正的无读取方键只有 3 个**：`cornerSmoothing`、`removeCurshorShakeTreshold`、
`shadowIsDirectional`、`alwaysUseDefaultCursor`（4 个，其中 `alwaysUseDefaultCursor`
的含义待查）。这几个都有官方静态值作为默认，属于「已存储、未实现」，
在队列的「明确未做」里保持诚实标注。

### Q23 指针的 y 轴原点没有独立核对过 ✅
结论：这是个「两边都自洽时看不出来」的问题——事件记录器用
`CGEventGetLocation`（Quartz，左上原点），合成器把 `cursor.y` 当「从顶部算」。
两边都按左上就对、都按左下也自洽（只是画面上下颠倒），**混合**才错，
而看代码两边都说得通。

两种独立办法都量了：
1. 探针直接问 API：`[NSEvent mouseLocation]` 与 `CGEventGetLocation` 的 y 之和
   恒等于屏幕高度（1050 pt，5 次采样全等），确认前者左下、后者左上。
2. **成片像素差分**：把「带指针」与「不带指针」的同参数成片逐像素相减，
   直接量出指针画到了哪里。60 秒处光标静止（xPx=1680 yPx=322）且不在任何
   缩放区间内，实测差分包围盒左上角 (1678, 391)，与「从顶部算」的预期
   (1680, 388) 相符，与「从底部算」的 (1680, 1712) 差 1300 多像素。

结论：**链路一致，没有上下颠倒。这一项没有改任何代码**——产出是「确认没问题」。
证据：`.dsh/unattended/evidence/pointer-coordinates.md`。

**过程中一次假警报值得记下**：第一次在 40 秒取样，量出指针中心 y≈790，
看着像差一半。实际是 40 秒刚好落在缩放区间 37175..39990 ms 结束之后一点，
**相机弹簧还在回位**，画面整体在动。换到 60 秒立刻对上。核对相机相关像素时
必须避开缩放过渡段，否则量到的是相机运动。

## 待用户验证（无人值守期间做不了）

按重要性排序。前两项直接影响能不能继续往下做。

1. **真机复录一次**（开始录制 → 暂停 → 继续 → 结束，屏幕/窗口/区域各一次）。
   自动验证做不到：`~/Movies` 下的素材按授权边界是只读的，而且需要真实的
   屏幕录制与输入监控授权。要看的是产出可播放 MP4、
   `project.json` 的 `state=readyForProcessing` 且 `error` 为空、
   窗口与区域来源的 `source.regionPoints` 与实际录制范围一致。
2. **观感验收**：成片里指针平滑度、点击缩放、相机跟随、**动态模糊强度**。
   证据帧在 `.dsh/unattended/evidence/`。动态模糊的位移上限
   （`src/render/MotionBlur.h` 的 `kMaximumSmearRatio`）是我选的不是量出来的，
   这是最可能需要调的一个数，改动只在一处。
3. **麦克风混音策略**：现在系统声音与麦克风等权相加（`normalize=0`）。
   是否该给麦克风更高权重、要不要提供两条独立音量，需要产品判断。
4. **剪辑交互的形态**：模型、控制器与界面都已在（Q16/Q17/Q19），当前是**单轨**：
   标尺 + 片段条 + 播放头 + 切分/删除/变速/撤销重做。要不要多轨（字幕轨、摄像头轨、
   音频轨）需要先定范围；单轨之外的都还没做。
   另外剪切目前只有「删除播放头附近固定时长」，**拖拽片段边缘改变时长、拖拽片段
   改变位置**都还没做，这是最可能需要先补的两项交互。
5. **圆角的单位**：参考工程里存的是无单位整数（12），导出时才有像素尺寸。
   按画布像素是 12 px，按来源点是 ~13.7 px，按来源像素是 ~6.9 px，差一倍。
   官方文档说整屏来源取圆角 0，但本机 6 个工程全是整屏来源、圆角却是 9/0/21/14/7/12，
   所以那条描述至少不是「整屏一律 0」。**需要一张参考导出帧量角落的实际像素半径**
   才能定，详见 `research/参考工程实测值.md`。当前按画布像素处理，三处产物一致。

## 明确未做

- **编辑器与时间线 UI**（模型与控制器已完成并可导出，缺的是界面）。
- **崩溃工程的自动修复**：分片写入后视频能读了（Q18），但 `state` 仍是 `failed`，
  且 `video-frames.jsonl` 可能比视频少最多 1 秒。要不要在启动时扫描并修复这类工程
  （自动修 / 提示用户 / 不处理）需要先定行为。
- 摄像头、字幕、快捷键显示、点击音效、背景音乐（设置键都已存在，无一接线；
  见 Q22 的分类）。
- `cornerSmoothing` / `removeCurshorShakeTreshold` / `shadowIsDirectional` /
  `alwaysUseDefaultCursor` 四个键已存储但未实现，前三个有官方静态默认值。
- 演示模式的实时合成输出（当前只对录制工程离线合成）。
- Windows 侧捕获适配器。
- 动态模糊的**实时**预览（离线已实现；实时需要另做优化，见 Q12）。
