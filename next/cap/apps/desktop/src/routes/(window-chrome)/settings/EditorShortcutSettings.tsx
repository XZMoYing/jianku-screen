import { createEventListener } from "@solid-primitives/event-listener";
import { type as ostype } from "@tauri-apps/plugin-os";
import { cx } from "cva";
import { createMemo, createSignal, For, Show } from "solid-js";
import { MotionGroup } from "~/components/InterfaceMotion";
import { editorKeymapStore } from "~/store";
import {
	type EditorCommand,
	type EditorKeymap,
	type EditorKeyPreset,
	editorBindingOwner,
	editorBindings,
	editorCommandLabels,
	eventStroke,
	isReservedEditorStroke,
	sameStroke,
	shortcutLabel,
} from "~/utils/editor-keymap";
import { t as localize } from "~/utils/i18n";
import type { Hotkey } from "~/utils/tauri";
import { Section, SectionCard } from "./Setting";

const presets: { id: EditorKeyPreset; name: string }[] = [
	{ id: "finalCutPro", name: "Final Cut Pro" },
	{ id: "legacy", name: "原有键位" },
];
const commandIds = Object.keys(editorCommandLabels) as EditorCommand[];

export function EditorShortcutSettings(props: { globalBindings: Hotkey[] }) {
	const settings = editorKeymapStore.createQuery();
	const mac = ostype() === "macos";
	const [listening, setListening] = createSignal<EditorCommand>();
	const [saving, setSaving] = createSignal(false);
	const [message, setMessage] = createSignal("");
	const bindings = createMemo(() => {
		const value = settings.data;
		return value && editorBindings(value, mac);
	});
	const isGlobal = (stroke: Hotkey) =>
		props.globalBindings.some((binding) => sameStroke(binding, stroke));

	async function save(value: Partial<EditorKeymap>) {
		setSaving(true);
		setMessage("");
		try {
			await editorKeymapStore.set(value);
			await settings.refetch();
			setListening();
		} catch {
			setMessage(localize("无法保存编辑器快捷键，请重试"));
		} finally {
			setSaving(false);
		}
	}

	function edit(command: EditorCommand, stroke: Hotkey | null | undefined) {
		const value = settings.data;
		if (!value || saving()) return;
		const overrides = { ...value.custom[value.preset] };
		if (stroke === undefined) delete overrides[command];
		else overrides[command] = stroke;
		void save({ custom: { ...value.custom, [value.preset]: overrides } });
	}

	createEventListener(
		window,
		"keydown",
		(event: KeyboardEvent) => {
			const command = listening();
			const value = settings.data;
			if (!command || !value || event.isComposing || event.repeat) return;
			if (event.code === "Tab") {
				setListening();
				setMessage("");
				return;
			}
			event.preventDefault();
			event.stopImmediatePropagation();
			if (saving()) return;
			if (event.code === "Escape") {
				setListening();
				setMessage("");
				return;
			}
			const stroke = eventStroke(event);
			if (/^(Shift|Control|Alt|Meta)(Left|Right)$/.test(stroke.code)) return;
			if (
				!/^(Key[A-Z]|Digit[0-9]|F[1-9]|F1[0-2]|Space|Backspace|Delete|Equal|Minus|Comma|Period|Slash|Semicolon|Quote|BracketLeft|BracketRight|Backslash|Backquote|NumpadAdd|NumpadSubtract)$/.test(
					stroke.code,
				) ||
				isReservedEditorStroke(stroke)
			) {
				setMessage(localize("这个键位由系统或界面导航使用，请选择其他键位"));
				return;
			}
			const owner = editorBindingOwner(value, mac, stroke, command);
			if (owner || isGlobal(stroke)) {
				setMessage(
					owner
						? localize("已用于「{command}」", {
								command: localize(editorCommandLabels[owner]),
							})
						: localize("该键位已被全局快捷键占用"),
				);
				return;
			}
			edit(command, stroke);
		},
		true,
	);

	const buttonClass =
		"rounded-lg bg-gray-3 px-2.5 py-1.5 text-xs font-medium text-gray-12 transition-colors hover:bg-gray-5 disabled:opacity-50";

	return (
		<Section
			title="编辑器快捷键"
			description="仅在编辑器内生效。每套预设分别保留你的改键。"
		>
			<Show when={settings.data && bindings()}>
				{(keys) => (
					<SectionCard class="p-4">
						<MotionGroup
							class="mb-3 inline-flex items-center gap-1 rounded-xl bg-ed-ctl p-1"
							label={localize("编辑器键位预设")}
						>
							<For each={presets}>
								{(preset) => (
									<button
										type="button"
										disabled={saving()}
										aria-pressed={settings.data?.preset === preset.id}
										class="rounded-lg px-3 py-1.5 text-xs font-medium text-ed-text-2 transition-colors hover:text-ed-text-1 disabled:opacity-60"
										onClick={() => {
											if (settings.data?.preset !== preset.id) {
												setListening();
												void save({ preset: preset.id });
											}
										}}
									>
										{localize(preset.name)}
									</button>
								)}
							</For>
						</MotionGroup>
						<p role="status" class="min-h-5 text-xs text-gray-11">
							{message() ||
								(listening() && localize("按下组合键，按 Esc 取消"))}
						</p>
						<div class="divide-y divide-gray-3">
							<For each={commandIds}>
								{(command) => {
									const override = () =>
										settings.data?.custom[settings.data.preset]?.[command];
									const conflicts = () => keys()[command].some(isGlobal);
									const shortcut = () =>
										keys()[command].find((key) => !isGlobal(key));
									return (
										<div class="flex min-h-10 items-center justify-between gap-2 py-1">
											<div class="text-[13px] text-gray-12">
												{localize(editorCommandLabels[command])}
												<Show when={conflicts()}>
													<p class="text-xs text-gray-10">
														{localize("该键位已被全局快捷键占用")}
													</p>
												</Show>
											</div>
											<div class="flex shrink-0 items-center gap-1">
												<button
													type="button"
													class={cx(
														buttonClass,
														listening() === command &&
															"bg-ed-accent-soft text-ed-accent",
													)}
													aria-label={localize("更改「{command}」的快捷键", {
														command: localize(editorCommandLabels[command]),
													})}
													aria-pressed={listening() === command}
													disabled={saving()}
													onBlur={() => {
														if (listening() === command && !saving()) {
															setListening();
															setMessage("");
														}
													}}
													onClick={(event) => {
														event.currentTarget.focus();
														setMessage("");
														setListening(
															listening() === command ? undefined : command,
														);
													}}
												>
													{listening() === command ? (
														localize("等待按键…")
													) : (
														<Show
															when={shortcut()}
															fallback={localize("未设置")}
															keyed
														>
															{(key) => shortcutLabel(key, mac)}
														</Show>
													)}
												</button>
												<Show when={keys()[command].length > 0}>
													<button
														type="button"
														class={buttonClass}
														disabled={saving()}
														onClick={() => edit(command, null)}
													>
														{localize("清除快捷键")}
													</button>
												</Show>
												<Show when={override() !== undefined}>
													<button
														type="button"
														class={buttonClass}
														disabled={saving()}
														onClick={() => edit(command, undefined)}
													>
														{localize("恢复预设键位")}
													</button>
												</Show>
											</div>
										</div>
									);
								}}
							</For>
						</div>
					</SectionCard>
				)}
			</Show>
		</Section>
	);
}
