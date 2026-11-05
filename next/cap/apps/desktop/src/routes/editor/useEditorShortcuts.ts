import { createEventListener } from "@solid-primitives/event-listener";
import { createContext } from "solid-js";
import type { EditorCommand } from "~/utils/editor-keymap";
import type { createEditorKeymap } from "./createEditorKeymap";

export function editorShortcutBlocked(event: KeyboardEvent) {
	if (
		event.defaultPrevented ||
		event.repeat ||
		event.isComposing ||
		event.key === "Process" ||
		event.keyCode === 229
	)
		return true;
	const scopedControl =
		'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="slider"], [role="listbox"], [role="menu"], [role="dialog"]';
	for (const target of [event.target, document.activeElement]) {
		if (!(target instanceof Element)) continue;
		if (target.closest(scopedControl)) return true;
		if (
			event.code === "Space" &&
			target.closest(
				'button, a[href], [role="button"], [role="tab"], [role="switch"], [role="checkbox"]',
			)
		)
			return true;
	}
	return !!document.querySelector(
		'[role="menu"][data-expanded], [role="listbox"][data-expanded], [role="dialog"][data-expanded]',
	);
}

export const EditorKeymapContext =
	createContext<ReturnType<typeof createEditorKeymap>>();

export function useEditorShortcuts(
	keymap: ReturnType<typeof createEditorKeymap>,
	handlers: Partial<
		Record<EditorCommand, () => boolean | void | Promise<void>>
	>,
) {
	const commands = Object.entries(handlers) as [
		EditorCommand,
		() => boolean | void | Promise<void>,
	][];
	createEventListener(window, "keydown", (event: KeyboardEvent) => {
		for (const [command, execute] of commands) {
			if (!keymap.matches(command, event)) continue;
			if (execute() !== false) event.preventDefault();
			break;
		}
	});
}
