import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type TimelineGestureSnapshot = Record<
	string,
	string | number | boolean | null
>;
export type TimelineGestureDiagnostic = {
	kind: "keyboard";
	cause: string;
	startedAt: number;
	elapsedMs: number;
	moves: number;
	buttons: number | null;
	snapshot: TimelineGestureSnapshot;
};

let enabled: Promise<boolean> | undefined;
let pending = Promise.resolve();
const records: TimelineGestureDiagnostic[] = [];

export function recordTimelineGesture(record: TimelineGestureDiagnostic) {
	if (!isTauri()) return Promise.resolve();
	pending = pending
		.then(async () => {
			const label = getCurrentWindow().label;
			if (!/^editor-\d+$/.test(label)) return;
			const fs = await import("@tauri-apps/plugin-fs");
			enabled ??= fs.exists("timeline-gesture-diagnostics.enabled", {
				baseDir: fs.BaseDirectory.AppData,
			});
			if (!(await enabled)) return;
			records.push(record);
			if (records.length > 32) records.shift();
			await fs.writeTextFile(
				`timeline-gesture-diagnostics-${label}.json`,
				JSON.stringify({ schema: 1, records }),
				{ baseDir: fs.BaseDirectory.AppData },
			);
		})
		.catch(() => {});
	return pending;
}
