# 键盘过滤项与导出关系实包验证（alpha.104，U22c2b5p）

在 alpha.104 上验证按键面板「显示修饰键 / 显示功能键」等过滤项的实际行为与导出关系。

## 结果

- **UI 过滤项**：按键标签→行为→「显示修饰键」由开切关后，工程配置 keyboard.settings.showModifiers 立即变为 false；退出重开工程后 UI 复选框仍为 0（持久化生效）；再切回开并确认 true 后退出。
- **导出与过滤项**：复制按键逐键夹具并注入 a/Shift/Enter/⌘ 四键，用安装包 cap-cli 导出 4 个变体（全部开/关修饰键/关功能键/仅对照），在 1.2/1.8/2.4 s 三帧比较：过滤项变体之间像素平均差 **0.0**；键盘启用 vs 禁用帧平均差 **0.426**（键盘确实参与导出）。
- **源码核对**：showModifiers/showSpecialKeys 仅用于 generate_keyboard_segments（录制事件→按键段生成）与设置 UI，渲染/导出不读取。因此导出对「已有按键段」不随过滤项变化属**设计行为**，不是导出缺陷。
- 结论：过滤项 UI 可切换且持久化；导出不受过滤项影响与源码一致。**真实录制生成时修饰键过滤效果与成片逐键观感仍未验证**，U22c2b5p 保持开放。

## 未覆盖

- 真实录制事件在 showModifiers=false 下生成段落是否剔除修饰键；显示功能键/大写开关的同类生成期验证；成片逐键字形/位置观感。

## 证据文件

- keyboard-filter-summary.json：UI 切换、持久化、导出对比与源码结论。
- kb-tab-on.json / kb-reopen.json / kb-editor.json：按键面板与重开后的 AX 快照。
- kb-all.mp4 / kb-nomod.mp4 / kb-nospecial.mp4 / kb-off.mp4：四组导出视频。
