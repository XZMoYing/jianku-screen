# 文字自动贴合与撤销/重做

2026-11-01，U22c3b1源码修复，安装仍alpha.51／回滚alpha.50。alpha.51实际原失败继续保留在../2026-11-01-alpha51/；这轮未安装新包，完整原生编辑器复验仍为U22c3b2，U22/c3父项不关闭。

## 原因与修正

TextOverlay.applyHug会按实际字体把尺寸和中心写回工程，在显示该文本或下一动画帧校正字体度量时执行。原createStoreHistory对所有这些写入创建新快照；撤销后再测量文字便清空重做分支，即使用户没有做新编辑。将原历史函数原样抽为project-history.ts以供真实历史回归，旧行为下的3项真实TextOverlay/实际Solid历史测试均失败，before.log.gz保存结果。

继续使用已安装的@solid-primitives/history，不替换成熟历史实现。新增仅供同步派生布局写入的applyDerived：先读取历史以收录同一外层batch中尚未结算的正常编辑，再在计数守卫内更新尺寸、刷新历史依赖，避免这一校正创建用户步骤/清掉重做。守卫结束后正常编辑继续被记录，错误和嵌套调用会恢复守卫。保留暂停/恢复拖动分组、onRestore和原快捷键语义。

TextOverlay只将原贴合写入包入此入口；测量、两像素宽度余量、锚点、字体/渲染和保存路径均保留。派生写入仍实际写入project，由原保存和预览监听消费，没有用关闭文字/测量/动画规避缺陷。

中间实现的同批用户更新回归曾失败：仅守卫后刷新会把该批未记录的用户编辑一起忽略。补上守卫前结算并通过验证，pending-before.log.gz仅代表开发中间态，不是额外的已发布版故障。该失败说明两处历史读取各有作用，不能把它们当冗余删除。

## 验证

- 开工起点4309e5f，Git干净，无前轮活跃构建；上轮是完整51交付与实际缺陷发现，属于progress。刚完成的完整原生包检查可复用，本轮未改Rust/渲染；先跑109项界面基线通过。
- 最终11项新增TextOverlay/真实StoreHistory回归及109项既有界面，共120项通过。覆盖首次显示测量、撤销后新显文字、下一帧度量变化、字体改动/锚点/重做、正常编辑分支、嵌套暂停、嵌套失败恢复、快捷键/owner清理、外层batch以及onRestore新显文字。度量尺寸在jsdom中模拟，不据此宣称真实字体外观已验收。
- 完整桌面TypeScript与最终完整前端构建通过；源码作用域Biome及差异检查通过。原函数抽出时的无用导入已删除，没有忽略检查/any。
- Chromium普通/减少动态效果各14个观察通过；本机AppKit/WKWebView同14个观察通过。这里挂载真实TextOverlay和真实历史，使用浏览器实际系统字体度量，首次框尺寸为x=0.0515625、y=0.05333333333333334；修改字体、测量、撤销/重做和同批用户更新的顺序均符合预期。上下文与吸附目标为合成夹具，未运行完整原生编辑器/保存/导出。

复现入口：next/cap下运行bun run --cwd apps/desktop vitest run --config vitest.interface.config.ts，以及bun run --cwd apps/desktop tsc --noEmit。浏览器运行JIANKU_BROWSER_PATH=/path/to/existing/chromium node ../verification/2026-11-01-text-history/verify-browser.mjs；脚本静态构建无服务器/下载，日志给出临时网页目录。将webkit-fixture.html交给../2026-11-01-mobile-scroll/wk-probe.swift，并核对JSON passed字段。

下一交付含本修复的新阶段包，按51原始未贴合文本配置，在完整编辑器中重做首次拖动/撤销/重做、字体改动和保存/重开/导出；实测前不能关闭c3b或改写51原失败。其他拖动控件、U23自动缩放生成、完整中文/内部审计、严格色度15通过/2失败、硬件成片变化、Windows/Linux和延期实机继续待办。
