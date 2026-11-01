# 拖动取消：文字轨道的遗留监听

2026-11-01，U22c2a诊断，尚未修复。产品源码与6554981保持一致，未打包，安装仍50／回滚49。前轮6554981属于progress；这轮产生新的运行证据，改变下一修复顺序，不把诊断当修复通过。

原TextTrack.tsx的createMouseDownDrag在独立createRoot中注册window.mousemove和mouseup，只有mouseup调用finish/dispose。finish才恢复projectHistory和拖动状态；该root没有连接组件onCleanup，也未处理blur。提取该真实监听块，用实际Solid客户端和event-listener库在Chromium运行；update/finish仅替换为计数器。

两个独立场景分别触发window.blur、销毁原Solid owner，然后发送mousemove。两者都仍调用update一次，finish次数保持0；手动mouseup后才清掉监听。observed-defect.json记录这一缺陷，observed=true表示原缺陷被观察到，绝不表示产品修复或完整编辑器验收通过。

AudioTrack和MaskTrack的普通拖动有相似结构，是后续核对对象；本次没有对这两种完整产品交互作运行结论。laneSegments按当前数组索引生成包装对象并在写入后排序，旧索引／组件重建可能扩大问题，但本次未证明此链路，应在修复时另用真实组件验证。

复现：在next/cap运行node ../verification/2026-11-01-drag-cancellation/probe.mjs。输出到/private/tmp/jianku-u22c2，需先创建该目录；使用本机已有Chromium，不下载或启动服务器。首次探针用CommonJS require.resolve访问仅ESM导出的event-listener失败，改为项目已安装包的真实dist入口后成功，未改依赖／产品。probe.log为成功运行，错误入口结论不计产品测试。

后续先补统一拖动所有权及终止路径：mouseup、blur、组件移除、删除／切换上下文和Esc；确保历史恢复一次、旧事件不再写入，明确取消是否回滚。接着处理排序后索引和稳定身份、轨道整段／边缘及其他控件，完整包实际验证后才关闭U22。U23自动缩放一段、中文／审计、严格色度15通过／2失败、硬件成片差异、Windows／Linux和延期实机继续保留。

此次只有诊断代码／文档变化，没有产品／Rust变化；核对上一轮所有产品哈希未变，未重复长构建。短周期额度从91%到下一次94%已用；按用户92%收尾条件，提交并备份本检查点后暂停，不将目标标complete。
