import { describe, expect, it, vi } from "vitest";
import { createEditorTitleSaveBridge } from "./editor-title-save-bridge";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((accept) => {
		resolve = accept;
	});
	return { promise, resolve };
}

async function setup() {
	const handlers = new Map<string, (payload: { requestId: string }) => void>();
	const cleanups = [vi.fn(), vi.fn()];
	const acknowledge = vi.fn(
		async (_response: { requestId: string; error: string | null }) => {},
	);
	const onError = vi.fn();
	let listener = 0;
	const bridge = createEditorTitleSaveBridge({
		listen: async (event, handler) => {
			handlers.set(event, handler);
			return cleanups[listener++];
		},
		acknowledge,
		onError,
	});
	await Promise.resolve();
	return {
		bridge,
		acknowledge,
		onError,
		cleanups,
		request: (requestId: string) =>
			handlers.get("editor-title-save-request")?.({ requestId }),
		cancel: (requestId: string) =>
			handlers.get("editor-title-save-cancelled")?.({ requestId }),
	};
}

describe("editor save acknowledgement lifecycle", () => {
	it("acknowledges an editor which has no editable content yet", async () => {
		const editor = await setup();
		await editor.request("loading");
		expect(editor.acknowledge).toHaveBeenCalledWith({
			requestId: "loading",
			error: null,
		});
		editor.bridge.dispose();
	});

	it("waits for the full healthy-editor save before acknowledging", async () => {
		const editor = await setup();
		const save = deferred<void>();
		const readOnly = vi.fn();
		editor.bridge.register({
			flush: () => save.promise,
			setReadOnly: readOnly,
		});
		const pending = editor.request("save");
		expect(readOnly).toHaveBeenLastCalledWith(true);
		expect(editor.acknowledge).not.toHaveBeenCalled();
		save.resolve();
		await pending;
		expect(editor.acknowledge).toHaveBeenCalledWith({
			requestId: "save",
			error: null,
		});
		expect(readOnly).toHaveBeenLastCalledWith(true);
		editor.cancel("save");
		expect(readOnly).toHaveBeenLastCalledWith(false);
		editor.bridge.dispose();
	});

	it("reports a real save failure instead of authorizing a successful quit", async () => {
		const editor = await setup();
		const flush = vi
			.fn()
			.mockRejectedValueOnce(new Error("disk is read-only"))
			.mockResolvedValueOnce(undefined);
		const readOnly = vi.fn();
		editor.bridge.register({ flush, setReadOnly: readOnly });
		await editor.request("first");
		expect(editor.acknowledge).toHaveBeenLastCalledWith({
			requestId: "first",
			error: "disk is read-only",
		});
		editor.cancel("first");
		expect(readOnly).toHaveBeenLastCalledWith(false);
		await editor.request("retry");
		expect(editor.acknowledge).toHaveBeenLastCalledWith({
			requestId: "retry",
			error: null,
		});
		editor.bridge.dispose();
	});

	it("ignores a late save from a cancelled request even when the request ID is reused", async () => {
		const editor = await setup();
		const first = deferred<void>();
		const second = deferred<void>();
		const readOnly = vi.fn();
		const flush = vi
			.fn()
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);
		editor.bridge.register({ flush, setReadOnly: readOnly });
		const old = editor.request("same-id");
		editor.cancel("same-id");
		const current = editor.request("same-id");
		first.resolve();
		await old;
		expect(editor.acknowledge).not.toHaveBeenCalled();
		expect(readOnly).toHaveBeenLastCalledWith(true);
		second.resolve();
		await current;
		expect(editor.acknowledge).toHaveBeenCalledTimes(1);
		editor.bridge.dispose();
	});

	it("keeps newly mounted title controls read-only while quit is admitted", async () => {
		const editor = await setup();
		await editor.request("loading");
		const readOnly = vi.fn();
		editor.bridge.register({ flush: async () => {}, setReadOnly: readOnly });
		expect(readOnly).toHaveBeenCalledWith(true);
		editor.cancel("unrelated");
		expect(readOnly).toHaveBeenLastCalledWith(true);
		editor.cancel("loading");
		expect(readOnly).toHaveBeenLastCalledWith(false);
		editor.bridge.dispose();
	});

	it("does not acknowledge after route disposal and removes both listeners", async () => {
		const editor = await setup();
		const save = deferred<void>();
		const readOnly = vi.fn();
		editor.bridge.register({
			flush: () => save.promise,
			setReadOnly: readOnly,
		});
		const pending = editor.request("closing");
		editor.bridge.dispose();
		editor.bridge.dispose();
		save.resolve();
		await pending;
		await Promise.resolve();
		expect(editor.acknowledge).not.toHaveBeenCalled();
		expect(readOnly).toHaveBeenLastCalledWith(false);
		for (const cleanup of editor.cleanups)
			expect(cleanup).toHaveBeenCalledTimes(1);
	});

	it("cleans a delayed listener without registering more after disposal", async () => {
		const ready = deferred<() => void>();
		const listen = vi.fn(() => ready.promise);
		const cleanup = vi.fn();
		const bridge = createEditorTitleSaveBridge({
			listen,
			acknowledge: vi.fn(),
			onError: vi.fn(),
		});
		bridge.dispose();
		ready.resolve(cleanup);
		await Promise.resolve();
		await Promise.resolve();
		expect(cleanup).toHaveBeenCalledTimes(1);
		expect(listen).toHaveBeenCalledTimes(1);
	});

	it("reports transport failures without an unhandled acknowledgement rejection", async () => {
		const editor = await setup();
		const error = new Error("window event transport unavailable");
		editor.acknowledge.mockRejectedValueOnce(error);
		await editor.request("failed-transport");
		expect(editor.onError).toHaveBeenCalledWith(error);
		editor.bridge.dispose();
	});
});
