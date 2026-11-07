# 按键段裁剪后的逐键 timeOffset 重基（U22c2b5t，源码修复）

## 问题

真实逐键数据下，`timeline.keyboardSegments[].keys[].timeOffset` 是相对段起点的毫秒偏移。alpha.96 及更早版本的编辑器中，拖动按键段**左右边缘裁剪只改 start/end**（`KeyboardTrack.tsx` 直接 `setProject(range)`），没有重基 keys：
- 左裁剪 start 右移后，所有 key 的绝对时间随段起点一起后移（画面/导出按键提示时间相对素材错位）；
- 右裁剪 end 左移后，超出新 end 的 key 仍保留在段内；
- `displayText` 不随被裁掉的 key 更新（生成段为逐键字符，手工段保留自定义文字）。

上游项目工程模型（`crates/project/src/keyboard.rs`）与前端波纹/删除/分割路径已有重基逻辑，唯独 UI 边缘裁剪路径缺失。

## 修复（9ccddfa）

- `keyboard-timing.ts` 新增 `rebaseKeyboardSegmentAfterTrim(segment, originalStart)`：按原起点计算每个 key 的绝对时间，丢弃落在新 start/end 之外的 key，保留的 key 重基为 `absolute - 新 start`（毫秒、保留 3 位小数避免浮点噪声）；当 `displayText` 与 keys 一一对应（每键一个字符）时同步为新保留键的字符，否则保留自定义 displayText。
- `KeyboardTrack.tsx` 在 release/history 且范围确实变化、且裁剪的是 start/end 边缘时调用该函数，并把新的 keys/displayText 与 start/end 合并写入同一个撤销事务（不额外增加撤销步骤）。
- 单测：`keyboard-timing.test.ts` 新增 4 项（左裁剪重基、右裁剪丢弃、非一一对应 displayText 保留、无 keys 不改动），文件共 17 项通过；`tsc --noEmit`、Biome 通过。

## 待实际包验证（alpha.97，冻结 16510b7，构建中）

1. 注入含多 key 的按键段（如 1.0–3.0、keys 偏移 0/500/1200/1800、displayText "abcd"）；
2. 真实鼠标左裁剪到约 1.4：配置应为 start 1.4、keys 偏移 100/800/1400、displayText "bcd"；右裁剪到约 2.5：keys 只剩 0/500/1200、displayText "abc"；
3. 移动整段：keys 偏移不变；一次撤销回到裁剪前；保存重开后配置与界面一致；
4. 未验证前不关闭 U22c2b5t。

## 未覆盖

- alpha.97 实际包原生验证、按键过滤/选择/分割、导出画面逐键时间点核对、真实采集按键数据；未使用用户真实工程。
