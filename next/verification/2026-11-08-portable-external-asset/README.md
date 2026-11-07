# 含外置素材的便携副本（alpha.104，U25b）

夹具：外置素材便携验收.jks（复制复验夹具并注入 imageSegments[0].path=/private/tmp/jianku-alpha104-20261108/external-asset.png，64×64 PNG）。

## 结果

- 编辑器 Cmd+Shift+S（save-copy）→ 保存面板设名「便携副本.jks」→ AXPress Save，生成 /private/tmp/jianku-alpha104-20261108/便携副本.jks。
- 外置图片被复制进副本：assets/portable/2cfc5eb3-d1f8-44de-805a-c63a839736e3/external-asset.png，SHA-256 与源一致（ca96adb5…90157）。
- 副本配置 imageSegments[0].path 重写为相对路径 assets/portable/…/external-asset.png；**配置中无 /private/tmp 绝对路径**。
- 源工程配置未被修改（仍为绝对路径 /private/tmp/…/external-asset.png）。
- 媒体哈希：content/display.mp4、content/speech.wav 源与副本 SHA-256 相同。
- 副本自动打开为编辑器工程「便携副本」，轨道含 图片 1；源工程与副本两个编辑器窗口同时存在。

## 结论

含外置素材的便携副本通过：外置素材复制进副本、路径重写相对且无绝对路径残留、媒体一致、副本可打开。关闭 U25b「外置素材便携副本路径重写」未覆盖；U25b 剩外部 SRT 导入往返、真实工程转场/变速/空隙其它组合。

## 证据

- portable-external-asset-summary.json；portable-dump.json（两个编辑器工程名与轨道）；external-asset.png（源图）。
