import { afterEach, beforeEach, expect, it, vi } from "vitest";

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
const stops: Array<() => void> = [];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
beforeEach(() => {
	vi.resetModules();
	mocks.native = true;
	mocks.label = "editor-42";
	mocks.exists.mockReset().mockResolvedValue(true);
	mocks.write.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
	for (const stop of stops.splice(0)) stop();
	document.body.replaceChildren();
});
const element = () => {
	const value = document.createElement("div");
	document.body.append(value);
	return value;
};
const last = () => {
	const call = mocks.write.mock.calls.at(-1);
	if (!call) throw new Error("Missing fallback diagnostic");
	return JSON.parse(call[1]);
};

it("does not access files or install observers outside Tauri", async () => {
	mocks.native = false;
	const { observeEditorFallback } = await import(
		"./editor-fallback-diagnostics"
	);
	const queries = vi.fn(() => []);
	stops.push(observeEditorFallback(element(), "route-suspense", queries));
	await settle();
	expect(mocks.exists).not.toHaveBeenCalled();
	expect(queries).not.toHaveBeenCalled();
	expect(mocks.write).not.toHaveBeenCalled();
});

it("requires explicit local opt-in before observing the editor", async () => {
	mocks.exists.mockResolvedValue(false);
	const { observeEditorFallback } = await import(
		"./editor-fallback-diagnostics"
	);
	const target = element();
	const queries = vi.fn(() => []);
	stops.push(observeEditorFallback(target, "route-suspense", queries));
	await settle();
	target.remove();
	await settle();
	expect(queries).not.toHaveBeenCalled();
	expect(mocks.write).not.toHaveBeenCalled();
});

it("records connected transitions with pending resources and cleans up owners", async () => {
	const { createRoot } = await import("solid-js");
	const {
		observeEditorFallback,
		registerEditorResource,
		editorFallbackSnapshot,
	} = await import("./editor-fallback-diagnostics");
	let state = "pending";
	createRoot((dispose) => {
		stops.push(dispose);
		registerEditorResource("recent-projects", () => state);
	});
	const target = element();
	const queries = () => [
		{
			queryKey: ["editor", "meta"],
			state: { status: "pending", fetchStatus: "fetching", data: undefined },
		},
	];
	const stop = observeEditorFallback(target, "route-suspense", queries);
	stops.push(stop);
	await expect.poll(() => mocks.write.mock.calls.length).toBe(1);
	expect(last().records[0]).toMatchObject({
		boundary: "route-suspense",
		connected: true,
		resources: [{ name: "recent-projects", state: "pending" }],
		queries: [{ name: "editor/meta", hasData: false }],
	});
	target.remove();
	await expect.poll(() => mocks.write.mock.calls.length).toBe(2);
	state = "ready";
	document.body.append(target);
	await expect.poll(() => mocks.write.mock.calls.length).toBe(3);
	expect(
		last().records.map((row: { connected: boolean }) => row.connected),
	).toEqual([true, false, true]);
	expect(last().records.at(-1).resources[0].state).toBe("ready");
	stop();
	target.remove();
	await settle();
	expect(mocks.write).toHaveBeenCalledTimes(3);
	for (const dispose of stops.splice(0)) dispose();
	expect(editorFallbackSnapshot([]).resources).toEqual([]);
});

it("does not activate a late opt-in response after disposal", async () => {
	let resolve!: (value: boolean) => void;
	mocks.exists.mockImplementation(
		() =>
			new Promise((done) => {
				resolve = done;
			}),
	);
	const { observeEditorFallback } = await import(
		"./editor-fallback-diagnostics"
	);
	const queries = vi.fn(() => []);
	const stop = observeEditorFallback(element(), "instance-data", queries);
	await settle();
	stop();
	resolve(true);
	await settle();
	expect(queries).not.toHaveBeenCalled();
	expect(mocks.write).not.toHaveBeenCalled();
});

it("excludes query keys, paths and data from the payload", async () => {
	const { editorFallbackSnapshot } = await import(
		"./editor-fallback-diagnostics"
	);
	const value = editorFallbackSnapshot([
		{
			queryKey: ["background-thumbnail", "/private/user-image.png"],
			state: { status: "pending", fetchStatus: "fetching", data: undefined },
		},
		{
			queryKey: ["private-title", "private-email"],
			state: {
				status: "success",
				fetchStatus: "idle",
				data: { secret: "private-content" },
			},
		},
	]);
	expect(JSON.stringify(value)).not.toContain("private");
	expect(JSON.stringify(value)).not.toContain("secret");
	expect(value.queries.map((query) => query.name)).toEqual([
		"background-thumbnail",
		"other",
	]);
});

it("rejects unexpected window labels without file access", async () => {
	mocks.label = "../other";
	const { observeEditorFallback } = await import(
		"./editor-fallback-diagnostics"
	);
	stops.push(observeEditorFallback(element(), "instance-data", () => []));
	await settle();
	expect(mocks.exists).not.toHaveBeenCalled();
	expect(mocks.write).not.toHaveBeenCalled();
});

it("retains at most 64 rows and recovers after a write error", async () => {
	mocks.write.mockRejectedValueOnce(new Error("temporary write failure"));
	const { observeEditorFallback } = await import(
		"./editor-fallback-diagnostics"
	);
	const target = element();
	stops.push(observeEditorFallback(target, "route-suspense", () => []));
	await expect.poll(() => mocks.write.mock.calls.length).toBe(1);
	for (let i = 0; i < 70; i++) {
		if (target.isConnected) target.remove();
		else document.body.append(target);
		await settle();
	}
	await expect.poll(() => mocks.write.mock.calls.length).toBe(71);
	expect(last().records).toHaveLength(64);
	expect(mocks.write.mock.calls.at(-1)?.[0]).toBe(
		"editor-fallback-diagnostics-editor-42.json",
	);
	expect(mocks.write.mock.calls.at(-1)?.[2]).toEqual({ baseDir: 14 });
});
