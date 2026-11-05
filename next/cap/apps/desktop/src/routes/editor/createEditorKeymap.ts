import { type as ostype } from "@tauri-apps/plugin-os";
import { createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { editorKeymapStore, hotkeysStore } from "~/store";
import {
	type EditorCommand,
	type EditorKeymap,
	editorBindings,
	editorKeymapDefaults,
	eventStroke,
	sameStroke,
	shortcutKeycaps,
	shortcutLabel,
} from "~/utils/editor-keymap";
import type { HotkeysStore } from "~/utils/tauri";

import { editorShortcutBlocked } from "./useEditorShortcuts";

export function createEditorKeymap(enabled: () => boolean) {
	const [preferences, setPreferences] = createSignal<EditorKeymap>();
	const [globals, setGlobals] = createSignal<HotkeysStore>();
	onMount(() => {
		let disposed = false;
		const connect = <T extends object>(
			store: {
				get(): Promise<T | undefined>;
				listen(fn: (data?: T) => void): Promise<() => void>;
			},
			update: (data?: T) => void,
		) => {
			let changed = false;
			const unsubscribe = store.listen((data) => {
				changed = true;
				if (!disposed) update(data);
			});
			void unsubscribe
				.then(() => store.get())
				.then((data) => {
					if (!disposed && !changed) update(data);
				})
				.catch(console.error);
			onCleanup(
				() => void unsubscribe.then((stop) => stop()).catch(console.error),
			);
		};
		onCleanup(() => {
			disposed = true;
		});
		connect(editorKeymapStore, (data) => setPreferences(data));
		connect(hotkeysStore, (data) => setGlobals(data));
	});
	const mac = ostype() === "macos";
	const bindings = createMemo(() => {
		const commands = editorBindings(preferences() ?? editorKeymapDefaults, mac);
		const reserved = Object.values(globals()?.hotkeys ?? {});
		for (const command of Object.keys(commands) as EditorCommand[]) {
			commands[command] = commands[command].filter(
				(key) => !reserved.some((global) => sameStroke(global, key)),
			);
		}
		return commands;
	});
	return {
		matches: (command: EditorCommand, event: KeyboardEvent) =>
			enabled() &&
			!editorShortcutBlocked(event) &&
			bindings()[command].some((binding) =>
				sameStroke(binding, eventStroke(event)),
			),
		kbd: (command: EditorCommand) => {
			const binding = bindings()[command][0];
			return binding ? shortcutKeycaps(binding, mac) : undefined;
		},
		legacy: () => preferences()?.preset === "legacy",
		label: (command: EditorCommand) => {
			const binding = bindings()[command][0];
			return binding ? shortcutLabel(binding, mac) : undefined;
		},
	};
}
