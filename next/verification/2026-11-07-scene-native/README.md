# 场景轨原生交互验收（alpha.91）

安装版 0.2.0-alpha.91／2026.91.0。在自有合成工程上，用真实鼠标事件（CGEvent HID）操作时间线「场景」轨，验证移动、两端裁剪、撤销、非时间字段保持、保存重开、重开后再编辑与播放预览。

## 夹具与关键前提

- 场景轨的可见条件包含 `meta().hasCamera`（`Timeline/index.tsx` 的 `sceneAvailable`）。首次用无摄像头录制元数据的合成工程注入 `sceneSegments` 时，工程配置里段存在但**界面不显示场景轨**；这是预期条件，不是缺陷。
- 因此夹具在复制自有合成工程后，追加 `content/camera.mp4`（复制 display.mp4）并在 `recording-meta.json` 的段里写入 `camera` 路径，再注入两条 `timeline.sceneSegments`（1.0–2.5 `default`、4.5–6.0 `cameraOnly`）。
- 重开后轨道头「选择轨道：场景」（屏幕 y 904，lane 相对中心 y≈901），AX 可见「场景／Default」「场景／Camera Only」与两侧手柄。

## 结果

| 步骤 | 操作 | 结果 |
| --- | --- | --- |
| 移动 | 首段 (460,901)→(510,901) + 保存 | 1.000–2.500 → 1.237–2.737；第二段不变 |
| 撤销移动 | Cmd+Z + 保存 | 回到 1.0–2.5 |
| 右端裁剪 | (596,901)→(626,901) + 保存 | end→2.642 |
| 撤销裁剪 | Cmd+Z + 保存 | 回到 1.0–2.5 |
| 左端裁剪 | (324,901)→(354,901) + 保存 | start→1.142 |
| 撤销裁剪 | Cmd+Z + 保存 | 回到 1.0–2.5 |
| 非时间字段 | 对比全部非 start/end 字段 | 完全保持（mode／splitLayout／transitionIn／transitionOut） |
| 保存重开 | 移动到 1.237–2.737 保存后关闭、重开 | 数值保持；AX 重现「场景／Default」「场景／Camera Only」与手柄 |
| 重开后再编辑 | 重开后拖动首段 +50 px + 保存 | 1.473–2.973（+0.236 s），第二段不变 |
| 播放预览 | 空格播放约 2.3 秒 | 时间码 2.00→3.24→4.33，暂停 5.02；两条场景标签全程在轨 |

## 未覆盖

- 场景轨分割／多选／排序、Esc 与失焦中断、CameraOnly／Split／Floating 等模式的**实际渲染观感**与导出、真实摄像头素材（本轮 camera 轨为复用 display.mp4 的合成占位）、场景与其他轨道的吸附组合；U22c2b4 与 U22 父项保持开放。
- 未使用用户真实工程与摄像头素材。

## 证据文件

- `sc-step-*.json`：每步之后的 `sceneSegments`。
- `sc-field-preservation.json`：非时间字段一致性。
- `sc-playback.json`：播放时间码与标签采样。
- `sc-ax-evidence.json`：重开后场景轨 AX 节点。
- `sc-fixture-segments.json`：注入的场景段夹具。
- `ui-drive.swift`、`editor-dump.swift`：真实输入与只读 AX 工具源码。
