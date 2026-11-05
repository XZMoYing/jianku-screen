import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { onCleanup } from "solid-js";

export type EditorFallbackBoundary =
	| "route-suspense"
	| "project-metadata"
	| "instance-data"
	| "export-suspense"
	| "unspecified";

type QuerySnapshot = {
	queryKey: readonly unknown[];
	state: { status: string; fetchStatus: string; data: unknown };
};

const resources = new Map<() => string, string>();
const queryNames = new Set([
	"store",
	"editor",
	"customDomain",
	"desktop-background",
	"background-thumbnail",
	"local-background-materials",
	"bundled-wallpapers",
	"animated-gradient-catalog",
	"editorRecordingTarget",
]);
const subkeys = new Set([
	"meta",
	"raw-meta",
	"general_settings",
	"animated_gradients",
	"audio_enhancement",
	"auth",
	"recording_settings",
	"presets",
]);
type Row = {
	at: number;
	boundary: EditorFallbackBoundary;
	connected: boolean;
	resources: Array<{ name: string; state: string }>;
	queries: Array<{
		name: string;
		status: string;
		fetchStatus: string;
		hasData: boolean;
	}>;
};
const records: Row[] = [];
let enabled: Promise<boolean> | undefined;
let pending = Promise.resolve();

export function registerEditorResource(name: string, state: () => string) {
	resources.set(state, name);
	onCleanup(() => resources.delete(state));
}

export function editorFallbackSnapshot(queries: readonly QuerySnapshot[]) {
	return {
		resources: Array.from(resources, ([state, name]) => {
			try {
				return { name, state: state() };
			} catch {
				return { name, state: "unavailable" };
			}
		}),
		queries: queries.slice(0, 40).map((query) => {
			const first = query.queryKey[0];
			const second = query.queryKey[1];
			const name =
				typeof first === "string" && queryNames.has(first) ? first : "other";
			return {
				name:
					(name === "editor" || name === "store") &&
					typeof second === "string" &&
					subkeys.has(second)
						? `${name}/${second}`
						: name,
				status: query.state.status,
				fetchStatus: query.state.fetchStatus,
				hasData: query.state.data !== undefined,
			};
		}),
	};
}

export function observeEditorFallback(
	element: HTMLElement,
	boundary: EditorFallbackBoundary,
	queries: () => readonly QuerySnapshot[],
) {
	let disposed = false;
	let observer: MutationObserver | undefined;
	if (isTauri()) {
		void import("@tauri-apps/plugin-fs")
			.then(async (fs) => {
				const label = getCurrentWindow().label;
				if (!/^editor-\d+$/.test(label)) return;
				enabled ??= fs.exists("timeline-gesture-diagnostics.enabled", {
					baseDir: fs.BaseDirectory.AppData,
				});
				if (!(await enabled) || disposed) return;
				let connected: boolean | undefined;
				const observe = () => {
					if (disposed || connected === element.isConnected) return;
					let snapshot: ReturnType<typeof editorFallbackSnapshot>;
					try {
						snapshot = editorFallbackSnapshot(queries());
					} catch {
						return;
					}
					connected = element.isConnected;
					records.push({
						at: Date.now(),
						boundary,
						connected,
						...snapshot,
					});
					if (records.length > 64) records.shift();
					const text = JSON.stringify({ schema: 1, records });
					pending = pending
						.then(() =>
							fs.writeTextFile(
								`editor-fallback-diagnostics-${label}.json`,
								text,
								{
									baseDir: fs.BaseDirectory.AppData,
								},
							),
						)
						.catch(() => {});
				};
				observer = new MutationObserver(observe);
				observer.observe(document.documentElement, {
					childList: true,
					subtree: true,
				});
				observe();
			})
			.catch(() => {});
	}
	return () => {
		disposed = true;
		observer?.disconnect();
	};
}
