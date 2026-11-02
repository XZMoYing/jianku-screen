import { createRoot } from "solid-js";
import { createStore } from "solid-js/store";
import { describe, expect, it, vi } from "vitest";
import { createAutoZoomGeneration } from "./auto-zoom-generation";
import { createStoreHistory } from "./project-history";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

function fixture() {
	let snapshot = "trimmed project";
	let revision = 0;
	const flush = deferred<void>();
	const generated = deferred<number[]>();
	const options = {
		snapshot: () => snapshot,
		revision: () => revision,
		flush: vi.fn(() => flush.promise),
		generate: vi.fn(() => generated.promise),
		apply: vi.fn(),
		setPending: vi.fn(),
		onEmpty: vi.fn(),
		onStale: vi.fn(),
		onError: vi.fn(),
	};
	return {
		options,
		flush,
		generated,
		controller: createAutoZoomGeneration(options),
		edit(value: string) {
			snapshot = value;
			revision++;
		},
	};
}

describe("auto zoom generation ownership", () => {
	it("flushes edits before the native request and applies once", async () => {
		const f = fixture();
		const task = f.controller.run();
		expect(f.options.generate).not.toHaveBeenCalled();
		f.flush.resolve();
		await Promise.resolve();
		expect(f.options.generate).toHaveBeenCalledOnce();
		f.generated.resolve([1, 2]);
		await task;
		expect(f.options.apply.mock.calls).toEqual([[[1, 2]]]);
		expect(f.options.setPending.mock.calls).toEqual([[true], [false]]);
	});

	it("does not request results for a project edited during the save", async () => {
		const f = fixture();
		const task = f.controller.run();
		f.edit("another trim");
		f.flush.resolve();
		await task;
		expect(f.options.generate).not.toHaveBeenCalled();
		expect(f.options.apply).not.toHaveBeenCalled();
		expect(f.options.onStale).toHaveBeenCalledOnce();
	});

	it("preserves manual edits made while the native request is pending", async () => {
		const f = fixture();
		const task = f.controller.run();
		f.flush.resolve();
		await Promise.resolve();
		f.edit("manual zoom");
		f.generated.resolve([7]);
		await task;
		expect(f.options.apply).not.toHaveBeenCalled();
		expect(f.options.onStale).toHaveBeenCalledOnce();
	});

	it("rejects a result after undo and redo return to the same snapshot", async () => {
		const f = fixture();
		const task = f.controller.run();
		f.flush.resolve();
		await Promise.resolve();
		f.edit("undo");
		f.edit("trimmed project");
		f.generated.resolve([7]);
		await task;
		expect(f.options.apply).not.toHaveBeenCalled();
		expect(f.options.onStale).toHaveBeenCalledOnce();
	});

	it("ignores duplicate requests while generation is pending", async () => {
		const f = fixture();
		const task = f.controller.run();
		await f.controller.run();
		f.flush.resolve();
		await Promise.resolve();
		f.generated.resolve([7]);
		await task;
		expect(f.options.flush).toHaveBeenCalledOnce();
		expect(f.options.generate).toHaveBeenCalledOnce();
	});

	it.each(["flush", "generation"])(
		"drops results after disposal during %s",
		async (stage) => {
			const f = fixture();
			const task = f.controller.run();
			if (stage === "generation") {
				f.flush.resolve();
				await Promise.resolve();
			}
			f.controller.dispose();
			f.flush.resolve();
			f.generated.resolve([7]);
			await task;
			await f.controller.run();
			expect(f.options.apply).not.toHaveBeenCalled();
			expect(f.options.onStale).not.toHaveBeenCalled();
			expect(f.options.setPending.mock.calls).toEqual([[true]]);
		},
	);

	it("reports no clicks without replacing the current track", async () => {
		const f = fixture();
		const task = f.controller.run();
		f.flush.resolve();
		await Promise.resolve();
		f.generated.resolve([]);
		await task;
		expect(f.options.onEmpty).toHaveBeenCalledOnce();
		expect(f.options.apply).not.toHaveBeenCalled();
	});

	it.each(["flush", "generation"])(
		"reports a %s failure and allows retry",
		async (stage) => {
			const f = fixture();
			const task = f.controller.run();
			const failure = new Error("synthetic failure");
			if (stage === "generation") {
				f.flush.resolve();
				await Promise.resolve();
				f.generated.reject(failure);
			} else f.flush.reject(failure);
			await task;
			expect(f.options.onError.mock.calls).toEqual([[failure]]);
			expect(f.options.setPending.mock.calls).toEqual([[true], [false]]);
			f.options.flush.mockResolvedValue(undefined);
			f.options.generate.mockResolvedValue([9]);
			await f.controller.run();
			expect(f.options.apply.mock.calls).toEqual([[[9]]]);
		},
	);

	it("records the generated track as one undoable edit", async () => {
		const context = createRoot((dispose) => {
			const [project, setProject] = createStore({ zoomSegments: [3] });
			const history = createStoreHistory(project, setProject);
			const controller = createAutoZoomGeneration({
				snapshot: () => JSON.stringify(project),
				revision: () => 0,
				flush: async () => {},
				generate: async () => [1, 2],
				apply: (segments) => setProject("zoomSegments", segments),
				setPending: vi.fn(),
				onEmpty: vi.fn(),
				onStale: vi.fn(),
				onError: vi.fn(),
			});
			return { dispose, project, history, controller };
		});
		try {
			await context.controller.run();
			expect([...context.project.zoomSegments]).toEqual([1, 2]);
			expect(context.history.canUndo()).toBe(true);
			context.history.undo();
			expect([...context.project.zoomSegments]).toEqual([3]);
			expect(context.history.canUndo()).toBe(false);
			context.history.redo();
			expect([...context.project.zoomSegments]).toEqual([1, 2]);
		} finally {
			context.dispose();
		}
	});
});
