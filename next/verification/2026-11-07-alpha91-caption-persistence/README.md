# alpha.91：字幕轨计时编辑保存重开持久化

版本 0.2.0-alpha.91／2026.91.0，冻结提交 d0a628c，候选标签 `next-v0.2.0-alpha.91-candidate`。修复 U25b1：字幕轨拖动／两侧裁剪的计时编辑此前只写派生轨道 `timeline.captionSegments`，重开工程时被源时间母版 `captions.segments` 重新投影覆盖；alpha.91 起在编辑结束时把输出时间反算回源时间并写回母版，派生轨道随之重新投影。

## 源码改动

- `34e62e5`：新增 `applyEditedCaptionTimingToMaster`（`captions.ts`）——`mapEditedTimeToSource` 反算起止；整段移动按源时间平移 words，裁剪时夹取／丢弃越界词；无法映射时返回 null 不改母版。`CaptionsTrack` 在拖动 `release`/`history` 结束时、同一历史事务内回写母版。
- `183d3c5`（alpha.91 冻结内）：补齐边界一致性——范围向外扩展时同步扩展首／末词边界，裁剪后无词落入范围时补一条覆盖整段的词，保证派生轨道（按词边界生成）与母版范围一致，不出现「母版 7.03、轨道 6.888」的错位。
- 单测：`captions.ts` 内新增 7 项（移动、倍速、裁剪夹取、全屏暂停窗、越界 null、扩展首末词、无词补段），该文件共 18 项通过；`tsc --noEmit`、Biome 通过。

## 实际包验证（alpha.91）

夹具为自有合成工程（4 条录音生成的字幕），真实鼠标操作字幕轨：

| 步骤 | 轨道 (captionSegments) | 母版 (captions.segments) | 说明 |
| --- | --- | --- | --- |
| 初始 | 0–1.79／2.09–4.92／4.92–6.51／7.37–8.0 | 同左 | — |
| 移动第 3 条 +50 px | 5.157–6.747 | 5.157–6.747 | 轨道与母版一致 |
| 关闭后 | 5.157–6.747 | 5.157–6.747 | — |
| 重开后 | 5.157–6.747 | 5.157–6.747 | **持久化通过** |
| 末尾裁剪 +30 px | 5.157–6.888 | 5.157–6.888，末词 Lantern end→6.888 | 扩展词边界后轨道与母版一致 |
| 关闭／重开后 | 5.157–6.888 | 5.157–6.888 | 持久化通过 |
| 起点裁剪 +30 px | 5.298–6.888 | 5.298–6.888，首词 Synthetic start→5.298 | — |
| 关闭／重开后 | 5.298–6.888 | 5.298–6.888 | **持久化通过**；AX 手柄位置与时间一致 |
| 边界 | 文本仍为「Synthetic Cobalt Lantern」等原文；其他三条字幕未变 | — | 文本与 words 未破坏 |

- 三处验签（源／归档／暂存／安装后）、版本 0.2.0-alpha.91／2026.91.0、六个可执行文件哈希一致；alpha.90 保留为回滚。
- 证据中的 `cp91-step-*.json` 记录每步的轨道／母版／words／文本；`cp91-ax-evidence.json` 为重开后字幕轨 AX 节点。

## 未覆盖

- 真实工程含转场／变速／空隙／全屏文字暂停窗时的原生持久化：当前由单测覆盖映射路径，未在原生工程逐组合实测；拆分为多段（`caption::edlN`）的字幕编辑也未实测。
- 字幕分割／多选／排序、SRT 导出、便携复制、旧外置字幕兼容仍属 U25b 其余范围；U25b 父项不关闭。
- 未读取或修改用户真实录制。

## 证据文件

- `cp91-step-*.json`：每步轨道／母版／words／文本。
- `cp91-config-edited.json`／`cp91-config-final.json`／`cp91-ax-evidence.json`：编辑后与最终工程配置、重开后 AX。
- `package-*.json`／`rollback-installed.json`／`prepare.log`／`install.log`／`release.log.gz`：构建与安装证据。
- `package91.py`／`verify-package.py`／`ui-drive.swift`／`editor-dump.swift`：本轮打包、验签与输入工具。
