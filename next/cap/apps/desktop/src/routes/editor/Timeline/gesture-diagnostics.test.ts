import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	native: true,
	label: "editor-42",
	exists: vi.fn(async () => true),
	write: vi.fn(async (_path: string, _text: string, _options: object) => {}),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => mocks.native }));
vi.mock("@tauri-apps/api/window", () => ({
	getCurrentWindow: () => ({ label: mocks.label }),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
	BaseDirectory: { AppData: 14 },
	exists: mocks.exists,
	writeTextFile: mocks.write,
}));
beforeEach(() => {
	vi.resetModules();
	mocks.native = true;
	mocks.label = "editor-42";
	mocks.exists.mockReset().mockResolvedValue(true);
	mocks.write.mockReset().mockResolvedValue(undefined);
});
const row = (value = 0) => ({
	kind: "keyboard" as const,
	cause: "invalid",
	startedAt: value,
	elapsedMs: 2,
	moves: 3,
	buttons: 1,
	snapshot: { sameSourceObject: true },
});
it("does not access files outside Tauri", async () => {
	mocks.native = false;
	const { recordTimelineGesture } = await import("./gesture-diagnostics");
	await recordTimelineGesture(row());
	expect(mocks.exists).not.toHaveBeenCalled();
	expect(mocks.write).not.toHaveBeenCalled();
});
it("requires the local opt-in file and checks it once", async () => {
	mocks.exists.mockResolvedValue(false);
	const { recordTimelineGesture } = await import("./gesture-diagnostics");
	await recordTimelineGesture(row());
	await recordTimelineGesture(row());
	expect(mocks.exists).toHaveBeenCalledTimes(1);
	expect(mocks.write).not.toHaveBeenCalled();
});
it("serializes writes and retains at most 32 diagnostic rows in its own app-data file", async () => {
	const { recordTimelineGesture } = await import("./gesture-diagnostics");
	await Promise.all(
		Array.from({ length: 40 }, (_, index) => recordTimelineGesture(row(index))),
	);
	const call = mocks.write.mock.calls.at(-1);
	if (!call) throw new Error("Missing diagnostic write");
	expect(call[0]).toBe("timeline-gesture-diagnostics-editor-42.json");
	expect(call[2]).toEqual({ baseDir: 14 });
	const data = JSON.parse(call[1]);
	expect(data.records).toHaveLength(32);
	expect(data.records[0].startedAt).toBe(8);
	expect(data.records.at(-1).startedAt).toBe(39);
});
it("keeps the write queue usable after a diagnostic write fails", async () => {
	mocks.write.mockRejectedValueOnce(new Error("unavailable"));
	const { recordTimelineGesture } = await import("./gesture-diagnostics");
	await recordTimelineGesture(row());
	await recordTimelineGesture(row(1));
	expect(mocks.write).toHaveBeenCalledTimes(2);
});
it("rejects unexpected window labels before touching the file system", async () => {
	mocks.label = "../unexpected";
	const { recordTimelineGesture } = await import("./gesture-diagnostics");
	await recordTimelineGesture(row());
	expect(mocks.exists).not.toHaveBeenCalled();
	expect(mocks.write).not.toHaveBeenCalled();
});
