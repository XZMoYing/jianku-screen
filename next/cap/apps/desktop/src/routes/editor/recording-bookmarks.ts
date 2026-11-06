import {
	type Accessor,
	createMemo,
	createResource,
	createSignal,
	untrack,
} from "solid-js";
import toast from "solid-toast";
import { t as localize } from "~/utils/i18n";
import {
	commands,
	type DeletedRecordingBookmark,
	type RecordingBookmark,
	type TimelineConfiguration,
} from "~/utils/tauri";
import { clipGapBefore } from "./clip-transitions";
import { registerEditorResource } from "./editor-fallback-diagnostics";
import { holdWindows } from "./timeline-holds";

export function bookmarkTimestamp(seconds: number) {
	const ticks = Math.round(seconds * 10);
	return `${Math.floor(ticks / 600)}:${((ticks % 600) / 10).toFixed(1).padStart(4, "0")}`;
}

export function createRecordingBookmarks(
	timeline: Accessor<TimelineConfiguration | null>,
	seek: (time: number) => Promise<void>,
) {
	// Mirrors locate_recording_bookmarks: visual edits do not change bookmark times.
	const signature = createMemo(() => {
		const value = timeline();
		return JSON.stringify(
			value
				? {
						segments: value.segments.map((clip) => [
							clip.recordingSegment ?? 0,
							clip.start,
							clip.end,
							clip.timescale,
							clipGapBefore(clip, value.mainTrackGaps),
						]),
						transitions: (value.transitions ?? []).map((transition) => [
							transition.segmentIndex,
							transition.duration,
						]),
						holds: holdWindows(value.textSegments),
					}
				: null,
		);
	});
	const [items, { refetch }] = createResource(signature, () => {
		const configuration: TimelineConfiguration | null = JSON.parse(
			untrack(() => JSON.stringify(timeline())),
		);
		return configuration
			? commands.getRecordingBookmarks(configuration)
			: Promise.resolve([]);
	});
	registerEditorResource("recording-bookmarks", () => items.state);
	const reload = async () => {
		await refetch();
		if (items.state === "errored") throw items.error;
	};
	const [busy, setBusy] = createSignal(false);
	const [deleted, setDeleted] = createSignal<DeletedRecordingBookmark[]>([]);
	const run = async (operation: () => Promise<void>) => {
		if (busy()) return false;
		setBusy(true);
		try {
			await operation();
			return true;
		} catch (error) {
			toast.error(
				localize(error instanceof Error ? error.message : String(error)),
			);
			return false;
		} finally {
			setBusy(false);
		}
	};
	return {
		items: () =>
			items.state === "ready" || items.state === "refreshing"
				? (items.latest ?? [])
				: [],
		loading: () => items.loading,
		error: () => {
			const error: unknown = items.error;
			return error
				? localize(error instanceof Error ? error.message : String(error))
				: undefined;
		},
		busy,
		refresh: () =>
			run(async () => {
				await reload();
			}),
		undoCount: () => deleted().length,
		save: (bookmark: RecordingBookmark, label: string | null) =>
			run(async () => {
				const removed = await commands.updateRecordingBookmark(
					bookmark.id,
					label,
				);
				if (removed)
					setDeleted((previous) => [...previous.slice(-19), removed]);
				await reload();
			}),
		undoDelete: () =>
			run(async () => {
				const last = deleted().at(-1);
				if (!last) return;
				await commands.restoreRecordingBookmark(last);
				setDeleted((previous) => previous.slice(0, -1));
				await reload();
			}),
		jump: (time: number) =>
			items.loading || items.state === "errored"
				? Promise.resolve(false)
				: run(() => seek(time)),
	};
}
