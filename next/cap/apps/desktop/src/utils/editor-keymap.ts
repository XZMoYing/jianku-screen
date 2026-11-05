import type { Hotkey } from "~/utils/tauri";

export const editorCommandLabels = {
	playPause: "播放／暂停",
	selectTool: "选择工具",
	bladeTool: "分割工具",
	split: "在播放头处分割",
	delete: "删除所选片段",
	selectAll: "选中当前轨道的全部片段",
	deselect: "取消选择",
	append: "添加到时间线末尾",
	zoomIn: "放大时间线",
	zoomOut: "缩小时间线",
	fit: "显示整个时间线",
	undo: "撤销",
	redo: "重做",
} as const;

export type EditorCommand = keyof typeof editorCommandLabels;
export type EditorKeyPreset = "finalCutPro" | "legacy";
export type EditorKeymap = {
	preset: EditorKeyPreset;
	custom: Partial<
		Record<EditorKeyPreset, Partial<Record<EditorCommand, Hotkey | null>>>
	>;
};

export const editorKeymapDefaults: EditorKeymap = {
	preset: "finalCutPro",
	custom: {},
};

export function keyStroke(
	code: string,
	modifiers: Partial<Omit<Hotkey, "code">> = {},
): Hotkey {
	return {
		code,
		ctrl: false,
		meta: false,
		shift: false,
		alt: false,
		...modifiers,
	};
}

export function eventStroke(event: KeyboardEvent): Hotkey {
	return {
		code: event.code,
		ctrl: event.ctrlKey,
		meta: event.metaKey,
		shift: event.shiftKey,
		alt: event.altKey,
	};
}

export function sameStroke(a: Hotkey, b: Hotkey) {
	return (
		a.code === b.code &&
		a.meta === b.meta &&
		a.ctrl === b.ctrl &&
		a.alt === b.alt &&
		a.shift === b.shift
	);
}

export function editorBindings(settings: EditorKeymap, mac: boolean) {
	const mod = mac ? { meta: true } : { ctrl: true };
	const legacy = settings.preset === "legacy";
	const bindings: Record<EditorCommand, Hotkey[]> = {
		playPause: [keyStroke("Space")],
		selectTool: legacy ? [] : [keyStroke("KeyA")],
		bladeTool: [keyStroke(legacy ? "KeyS" : "KeyB")],
		split: [legacy ? keyStroke("KeyC") : keyStroke("KeyB", mod)],
		delete: mac
			? [keyStroke("Backspace"), keyStroke("Delete")]
			: [keyStroke("Delete"), keyStroke("Backspace")],
		selectAll: [keyStroke("KeyA", mod)],
		deselect: [keyStroke("Escape")],
		append: legacy ? [] : [keyStroke("KeyE")],
		zoomIn: [
			keyStroke("Equal", mod),
			keyStroke("Equal", { ...mod, shift: true }),
			keyStroke("NumpadAdd", mod),
		],
		zoomOut: [keyStroke("Minus", mod), keyStroke("NumpadSubtract", mod)],
		fit: legacy ? [] : [keyStroke("KeyZ", { shift: true })],
		undo: [keyStroke("KeyZ", mod)],
		redo: [
			keyStroke("KeyZ", { ...mod, shift: true }),
			...(!mac || legacy ? [keyStroke("KeyY", mod)] : []),
		],
	};

	for (const command of Object.keys(bindings) as EditorCommand[]) {
		const binding = settings.custom[settings.preset]?.[command];
		if (binding !== undefined) bindings[command] = binding ? [binding] : [];
	}
	return bindings;
}

export function editorBindingOwner(
	settings: EditorKeymap,
	mac: boolean,
	stroke: Hotkey,
	except?: EditorCommand,
) {
	const bindings = editorBindings(settings, mac);
	return (Object.keys(bindings) as EditorCommand[]).find(
		(command) =>
			command !== except &&
			bindings[command].some((key) => sameStroke(key, stroke)),
	);
}

export function isReservedEditorStroke(stroke: Hotkey) {
	// Project menu and native window actions own these combinations.
	return (
		((stroke.meta || stroke.ctrl) &&
			["KeyS", "KeyO", "KeyW", "KeyQ", "KeyM", "KeyH", "KeyF"].includes(
				stroke.code,
			)) ||
		(stroke.alt && stroke.code === "F4") ||
		(stroke.ctrl && stroke.shift && stroke.code === "F9") ||
		[
			"Tab",
			"Enter",
			"Escape",
			"ArrowLeft",
			"ArrowRight",
			"ArrowUp",
			"ArrowDown",
		].includes(stroke.code)
	);
}

export function shortcutKeycaps(stroke: Hotkey, mac: boolean) {
	const label: Record<string, string> = {
		Space: "Space",
		Backspace: mac ? "⌫" : "Backspace",
		Delete: mac ? "⌦" : "Delete",
		Escape: "Esc",
		Equal: stroke.shift ? "+" : "=",
		Minus: "−",
		NumpadAdd: "+",
		NumpadSubtract: "−",
		Comma: ",",
		Period: ".",
		Slash: "/",
		Semicolon: ";",
		Quote: "'",
		BracketLeft: "[",
		BracketRight: "]",
		Backslash: "\\",
		Backquote: "`",
	};
	return [
		...(stroke.ctrl ? ["ctrl"] : []),
		...(stroke.alt ? ["alt"] : []),
		...(stroke.shift ? ["shift"] : []),
		...(stroke.meta ? [mac ? "meta" : "Super"] : []),
		label[stroke.code] ?? stroke.code.replace(/^(Key|Digit)/, ""),
	];
}

export function shortcutLabel(stroke: Hotkey, mac: boolean) {
	const modifiers: Record<string, string> = mac
		? { meta: "⌘", ctrl: "⌃", shift: "⇧", alt: "⌥" }
		: { meta: "Meta", ctrl: "Ctrl", shift: "Shift", alt: "Alt" };
	return shortcutKeycaps(stroke, mac)
		.map((key) => modifiers[key] ?? key)
		.join(mac ? "" : "+");
}
