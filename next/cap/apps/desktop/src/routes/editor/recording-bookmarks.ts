import {
	type Accessor,
	createMemo,
	createResource,
	createSignal,
} from "solid-js";
import toast from "solid-toast";
import { t as localize } from "~/utils/i18n";
import {
	commands,
	type DeletedRecordingBookmark,
	type RecordingBookmark,
	type TimelineConfiguration,
} from "~/utils/tauri";

export function bookmarkTimestamp(seconds: number) {
	const ticks = Math.round(seconds * 10);
	return `${Math.floor(ticks / 600)}:${((ticks % 600) / 10).toFixed(1).padStart(4, "0")}`;
}

export function createRecordingBookmarks(
	timeline: Accessor<TimelineConfiguration | null>,
	seek: (time: number) => Promise<void>,
) {
	const signature = createMemo(() => JSON.stringify(timeline()));
	const [items, { refetch }] = createResource(signature, (encoded) => {
		const configuration: TimelineConfiguration | null = JSON.parse(encoded);
		return configuration
			? commands.getRecordingBookmarks(configuration)
			: Promise.resolve([]);
	});
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
		items: () => (items.error ? [] : items()),
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
				await refetch();
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
				await refetch();
			}),
		undoDelete: () =>
			run(async () => {
				const last = deleted().at(-1);
				if (!last) return;
				await commands.restoreRecordingBookmark(last);
				setDeleted((previous) => previous.slice(0, -1));
				await refetch();
			}),
		jump: (time: number) => run(() => seek(time)),
	};
}
