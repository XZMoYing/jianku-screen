import { describe, expect, it, vi } from "vitest";
import { createPreviewFullscreen } from "./preview-fullscreen";

function harness(initial = false) {
	let native = initial;
	const window = {
		isFullscreen: vi.fn(async () => native),
		setFullscreen: vi.fn(async (value: boolean) => {
			native = value;
		}),
	};
	const changed = vi.fn();
	const failed = vi.fn();
	const controller = createPreviewFullscreen({ window, changed, failed });
	return { window, changed, failed, controller, native: () => native };
}

describe("preview fullscreen window ownership", () => {
	it("restores a normal window without touching media or project state", async () => {
		const h = harness();
		await h.controller.request(true);
		expect(h.controller.active()).toBe(true);
		await h.controller.request(false);
		expect(h.window.setFullscreen.mock.calls).toEqual([[true], [false]]);
		expect(h.changed.mock.calls).toEqual([[true], [false]]);
	});

	it("preserves a window that was already fullscreen", async () => {
		const h = harness(true);
		await h.controller.request(true);
		await h.controller.request(false);
		expect(h.window.setFullscreen).not.toHaveBeenCalled();
		expect(h.native()).toBe(true);
	});

	it("a quick exit cancels entry before changing the native window", async () => {
		const h = harness();
		const enter = h.controller.request(true);
		const exit = h.controller.request(false);
		await Promise.all([enter, exit]);
		expect(h.window.setFullscreen).not.toHaveBeenCalled();
		expect(h.controller.active()).toBe(false);
	});

	it("restores native state when disposed during an in-flight entry", async () => {
		const h = harness();
		let finish!: () => void;
		h.window.setFullscreen.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		);
		const enter = h.controller.request(true);
		await vi.waitFor(() => expect(finish).toBeDefined());
		const disposed = h.controller.dispose();
		finish();
		await Promise.all([enter, disposed]);
		expect(h.window.setFullscreen.mock.calls).toEqual([[true], [false]]);
		expect(h.changed).not.toHaveBeenCalled();
		expect(h.controller.active()).toBe(false);
	});

	it("keeps retry available after the native fullscreen request fails", async () => {
		const h = harness();
		h.window.setFullscreen.mockRejectedValueOnce(new Error("denied"));
		await h.controller.request(true);
		expect(h.controller.active()).toBe(false);
		expect(h.failed).toHaveBeenCalledOnce();
		await h.controller.request(true);
		expect(h.controller.active()).toBe(true);
	});

	it("accepts a new entry while an earlier no-op exit is settling", async () => {
		const h = harness();
		const exit = h.controller.request(false);
		const enter = h.controller.request(true);
		await Promise.all([exit, enter]);
		expect(h.controller.active()).toBe(true);
		expect(h.window.setFullscreen.mock.calls).toEqual([[true]]);
	});

	it("retains preview controls when leaving native fullscreen fails", async () => {
		const h = harness();
		await h.controller.request(true);
		h.window.setFullscreen.mockRejectedValueOnce(new Error("busy"));
		await h.controller.request(false);
		expect(h.controller.active()).toBe(true);
		await h.controller.request(false);
		expect(h.controller.active()).toBe(false);
	});

	it("returns the editor layout after an external native fullscreen exit", async () => {
		const h = harness();
		await h.controller.request(true);
		h.window.isFullscreen.mockResolvedValueOnce(false);
		await h.controller.nativeChanged();
		expect(h.controller.active()).toBe(false);
		expect(h.changed).toHaveBeenLastCalledWith(false);
	});
});
