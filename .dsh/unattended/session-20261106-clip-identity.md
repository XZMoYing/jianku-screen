# 编辑器片段身份与统一重排（进行中）

原goal active确认，起点23f57b2干净／周37%无5h两券未用；上轮U12a是真实源码与Mac检查进展，已备份。当前安装仍63，最近PID15721/CG22166的自有归档示例保持打开；本轮没动桌面、用户工程、设备或网络。

本轮选择U29必要基础，尚未实现所有关联跟随：主轨缺持久实例ID，同一源可重复、数组index会变，不能直接以数组索引绑定光标/按键/镜头。configuration.rs TimelineSegment新增serde default/skip None的id Option<String>；原生新构造暂None，前端旧工程确定性legacy-clip-index分配（预留已有ID防偷占）、新用户创建/split用clip-UUID。正常ID序列化保存；合并保留左身份，保留选中片段的外观设置；中间删除保留左ID/右部新ID。不移除旧字段、不改渲染/曲线。

Terra motion_baseline机械补13个Rust文件34处id:None，主代理拥有configuration.rs的字段/3构造/1往返测试。82277六crate release check/fmt正常0，69131身份往返/旧格式测试1项正常0。canonical绑定生成12616仍live（最近ps cargo PID23852/compile24821），日志/private/tmp/jianku-clip-identity-20261106/bindings.log，**先续同句柄，不重复、不手改tauri.ts、不改Rust直到结束**。worker会报告。主代理同时改TS。

TS新增clip-identity.ts/tests，context normalizeProject/serialize都规范ID；split右片新ID；clip-merge保留左ID；timeline-utils中间切分右片新ID（无ID旧通用fixture保持原样）。workspace_tests仅改Player1处、Transcript1处、Timeline/index4处真实timeline新片创建，临时render fallback不生成随机ID，sectionMarker无实际写入未改。主代理已格式化相关文件。

新增clip-reorder.ts把原ClipsSidebar重排/丢转场补时逻辑提到公共函数，**仍沿用原overlay时序处理，不冒称关联跟随已做好**；context projectActions.moveClipSegment按ID查最新index、重映射并保留clip选择。ClipsSidebar删除旧同段算法；拖动/改名状态改ID，采用既有createTimelineMouseDrag（Escape/blur/history/dispose/invalid取消），松手按最新Y算插入点且须在可见列表内才提交。目标消失不会误动新index对象。需实际app64验证，当前63无本代码。

9新身份/重排模型与相关合并/ripple旧模型检查已启动句柄99164，日志/private/tmp/jianku-clip-identity-20261106/models.log，先确认终态。新增模型文件clip-identity.test.ts/clip-reorder.test.ts。后续：检查模型结果，等真实绑定生成后类型/前端/必要真实history上下文检查；修问题，不把pure模型当原生UI通过。然后源码提交/备份，冻结下一包做自有重复素材拖动/Escape/失焦/删除目标/选中/Undo/保存重开验证。原先想做完整关联重排，但时间域含hold/转场/倍速且无身份，先完成这一有真实拖动收益的完整基础单元；关联轨道映射、磁吸、独立吸附、所有右键、默认FCP、UI分类与后置U30仍须继续，不缩小总目标。

另U12a已拆平台配置，后续Mac release必须走node scripts/jianku.mjs release，让helper合并tauri.jianku.conf.json+tauri.jianku.macos.json；不要用仅共用配置遗漏移动组件。所有原中文/审计/严格色度15过2失败/硬件成片/Windows/Linux/延期实机门槛继续。额度用最新规则，不沿用旧85/92。

模型99164已终态0：身份6／重排3／原合并5／原ripple3，共17过。绑定12616最近实查仍live，未启动第二份。workspace_tests正只写新ClipsSidebar.identity.test.tsx，针对真实组件少量拖动交互，不改产品。data-clip-id可识别卡片；下一等绑定并类型/前端，不将这些模型当实际App通过。

worker真实ClipsSidebar组件5项交互通过（同源ID/最终松手位置/各取消条件），主代理已读测试确认渲染真实组件，但不是完整App；初期测试环境缺图标/断言API/模拟边界修正属harness问题，不算产品失败消失。64验证工具在next/verification/2026-11-06-alpha64仅prepared，版本源码仍63尚未冻结／构建，不能提前归档或安装。后续canonical release使用平台合并入口，64只在源检查完成后.bump共同版本字段。

等待绑定期间Terra只读平台矩阵已保存docs/跨平台能力与依赖矩阵.md，主代理核对移动setup非Mac拒绝／演示非Mac分支；12行初版不关闭U12，音频摄像头细分／非Mac静态壁纸／编译缺口仍需补齐。没有动任何目标平台命令或代码，不把U12a已修项重复列未修。

绑定12616已终态0并实际生成tauri.ts，主代理diff仅TimelineSegment新增id可选字符串/空值，未手改。真实ClipsSidebar测试已接入持久vitest.interface.config.ts，用正式配置重跑5过（97179终态0）；不再依赖worker临时配置。新类型检查已启动，日志types.log，先续其句柄。Rust/绑定均无活动句柄。

源码阶段检查终态：12580类型／57764前端均0；12616绑定已正常0，diff仅id新属性，22个相关模型／组件和1原生兼容已通过，没做无关测试。共同配置版本已改64／2026.64.0，原生版本字段仍单文件。证据next/verification/2026-11-06-clip-identity/。下一提交源并冻结64/canonical release，再生成源码manifest，勿把63运行窗口当64。

最终补充：blast复核发现CLI 1处/可选GPUI12处构造，Terra已补None并格式化5文件；CLI check87681正常0，独立GPUI offline check退出101是缺本地next/zed-cap/crates/gpui/Cargo.toml，不下载／不启用，不能标绿。Schema未改，不重复绑定生成。

主代理补历史after-restore回调，前／状态／后恢复一起batch。context保存当前clip IDs，恢复后仍存在的ID重映射选择；别类选择仍按旧规则清除。18模型＋13历史/真实组件均通过；最终类型10424／rootfmt50710／前端14567都终态0。当前无编译／测试／导出句柄；下一源码提交/冻结64，完整App实际验收仍待。相关最终日志已入clip-identity证据，保留初期及最终范围。不把原overlay绝对时序行为说成完整关联移动。

64构建检查点：源ca9f7e5已提交；唯一canonical release57249日志/private/tmp/jianku-alpha64-20261106/release.log运行。之后不改CAP冻结输入，不重复编译／绑定生成。新平台配置合并入口已用（Mac仍5sidecars）。source/rollback manifest与验证工具next/verification/2026-11-06-alpha64均prepared，63归档验签／6hash已核实，64尚未prepare/安装。私有demo.jks已从63自有样本APFS克隆：三片段步骤甲0..4、步骤乙重复0..4且hideCursor、步骤丙4..8/volume1.1，均无id测试legacy，overlay空以聚焦身份；未在63打开。只在64包prepare后复制到版本归档verification，不能提前建Builds/0.2.0-alpha.64目录。

续构建前已实查release57249对应node PID33125/33141仍live，CLI/前端阶段已过，进入桌面原生编译；不是观察超时就重启。64的AX/拖动(含Escape)/单窗口采集工具均已编译，root工具源已prepared，drag55462终态0。当前共同源不得变，先完成此包；实际GUI只在确认63仍为自有示例且无未知录制后保存/正常退出再安装。Native截图/录像必须只包含目标自有窗口，不能复用曾忽略-l的系统整屏命令。

阶段额度最新周已用46%，无5h窗口，两券未用，不暂停、不设定时。源ca9f7e5已推，待64构建/归档/安装/原生身份与Undo验收；下一轮继续唯一57249。完整目标active，U29/U30及所有原门槛仍未完成。
