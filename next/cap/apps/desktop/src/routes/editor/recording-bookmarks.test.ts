import { createRoot, createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { commands, type TimelineConfiguration } from "~/utils/tauri";
import { createRecordingBookmarks } from "./recording-bookmarks";

vi.mock("solid-js", () => vi.importActual("solid-js/dist/solid.js"));
vi.mock("solid-toast", () => ({ default: { error: vi.fn() } }));
vi.mock("~/utils/i18n", () => ({ t: (text: string) => text }));
vi.mock("~/utils/tauri", () => ({
	commands: {
		getRecordingBookmarks: vi.fn().mockResolvedValue([]),
		updateRecordingBookmark: vi.fn(),
		restoreRecordingBookmark: vi.fn(),
	},
}));

const bookmark = { id: "one", label: "重点", recordingSegment: 0, time: 2 };
const deleted = { bookmark, index: 0 };

describe("bookmark editing session", () => {
	it("keeps the editor usable after a bookmark read error and allows a retry", async () => {
		vi.mocked(commands.getRecordingBookmarks)
			.mockRejectedValueOnce("invalid bookmark data")
			.mockResolvedValueOnce([{ bookmark, positions: [2] }]);
		const { session, dispose } = createRoot((dispose) => ({
			session: createRecordingBookmarks(
				() =>
					({
						segments: [],
						zoomSegments: [],
					}) as unknown as TimelineConfiguration,
				vi.fn(),
			),
			dispose,
		}));
		try {
			await vi.waitFor(() => expect(session.error()).toBeTruthy());
			expect(() => session.items()).not.toThrow();
			expect(session.items()).toEqual([]);
			expect(await session.refresh()).toBe(true);
			expect(session.error()).toBeUndefined();
			expect(session.items()).toHaveLength(1);
		} finally {
			dispose();
		}
	});

	it("retains a failed restore for retry and clears it only after a successful save", async () => {
		vi.mocked(commands.updateRecordingBookmark).mockResolvedValue(deleted);
		vi.mocked(commands.restoreRecordingBookmark)
			.mockRejectedValueOnce("disk full")
			.mockResolvedValueOnce(null);
		const { session, dispose } = createRoot((dispose) => ({
			session: createRecordingBookmarks(() => null, vi.fn()),
			dispose,
		}));
		try {
			expect(await session.save(bookmark, null)).toBe(true);
			expect(session.undoCount()).toBe(1);
			expect(await session.undoDelete()).toBe(false);
			expect(session.undoCount()).toBe(1);
			expect(await session.undoDelete()).toBe(true);
			expect(session.undoCount()).toBe(0);
		} finally {
			dispose();
		}
	});

	it("rejects overlapping mutations and does not add a failed deletion to undo", async () => {
		let reject: (error: Error) => void = () => {};
		vi.mocked(commands.updateRecordingBookmark).mockImplementationOnce(
			() =>
				new Promise((_, failure) => {
					reject = failure;
				}),
		);
		const { session, dispose } = createRoot((dispose) => ({
			session: createRecordingBookmarks(() => null, vi.fn()),
			dispose,
		}));
		try {
			const pending = session.save(bookmark, null);
			expect(session.busy()).toBe(true);
			expect(await session.save(bookmark, "name")).toBe(false);
			reject(new Error("read-only project"));
			expect(await pending).toBe(false);
			expect(session.busy()).toBe(false);
			expect(session.undoCount()).toBe(0);
		} finally {
			dispose();
		}
	});

	it("does not query the backend again for an equivalent timeline snapshot", async () => {
		vi.mocked(commands.getRecordingBookmarks).mockClear();
		const configuration = {
			segments: [],
			zoomSegments: [],
		} as unknown as TimelineConfiguration;
		const { setTimeline, dispose } = createRoot((dispose) => {
			const [timeline, setTimeline] = createSignal(configuration);
			createRecordingBookmarks(timeline, vi.fn());
			return { setTimeline, dispose };
		});
		try {
			await Promise.resolve();
			setTimeline({ ...configuration });
			await Promise.resolve();
			expect(commands.getRecordingBookmarks).toHaveBeenCalledTimes(1);
		} finally {
			dispose();
		}
	});
});
