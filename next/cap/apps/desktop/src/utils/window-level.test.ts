import { describe, expect, it, vi } from "vitest";
import { enqueueWindowLevelUpdate, setMainWindowPinned } from "./window-level";

function fixture(pinned = false, level = pinned) {
	const window = {
		label: "main",
		isAlwaysOnTop: vi.fn(async () => level),
		setAlwaysOnTop: vi.fn(async (next: boolean) => {
			level = next;
		}),
	};
	const settings = {
		get: vi.fn(async () => ({ mainWindowAlwaysOnTop: pinned })),
		set: vi.fn(async (value: { mainWindowAlwaysOnTop: boolean }) => {
			pinned = value.mainWindowAlwaysOnTop;
		}),
	};
	return { window, settings, pinned: () => pinned, level: () => level };
}

describe("main window pin preference", () => {
	it("changes and persists only the Main preference in both directions", async () => {
		const f = fixture();
		await setMainWindowPinned(f.window, f.settings, true);
		expect(f.level()).toBe(true);
		expect(f.pinned()).toBe(true);
		await setMainWindowPinned(f.window, f.settings, false);
		expect(f.level()).toBe(false);
		expect(f.pinned()).toBe(false);
		expect(f.settings.set.mock.calls).toEqual([
			[{ mainWindowAlwaysOnTop: true }],
			[{ mainWindowAlwaysOnTop: false }],
		]);
	});

	it.each(["camera", "recording-controls", "target-select-overlay-1"])(
		"does not change the %s window or its saved preference",
		async (label) => {
			const f = fixture();
			f.window.label = label;
			await expect(
				setMainWindowPinned(f.window, f.settings, true),
			).rejects.toThrow("Only the main window");
			expect(f.window.setAlwaysOnTop).not.toHaveBeenCalled();
			expect(f.settings.get).not.toHaveBeenCalled();
			expect(f.settings.set).not.toHaveBeenCalled();
		},
	);

	it("does not persist a change rejected by the window system", async () => {
		const f = fixture();
		f.window.setAlwaysOnTop.mockRejectedValueOnce(
			new Error("Window unavailable"),
		);
		await expect(
			setMainWindowPinned(f.window, f.settings, true),
		).rejects.toThrow("Window unavailable");
		expect(f.pinned()).toBe(false);
		expect(f.settings.set).not.toHaveBeenCalled();
	});

	it("restores the persisted preference and the actual temporarily lowered level on save failure", async () => {
		const f = fixture(true, false);
		f.settings.set.mockImplementationOnce(async () => {
			throw new Error("Disk full");
		});
		await expect(
			setMainWindowPinned(f.window, f.settings, true),
		).rejects.toThrow("Disk full");
		expect(f.level()).toBe(false);
		expect(f.pinned()).toBe(true);
		expect(f.window.setAlwaysOnTop.mock.calls).toEqual([[true], [false]]);
	});

	it("preserves the original and rollback errors and lets the next change recover", async () => {
		const f = fixture();
		f.settings.set.mockRejectedValueOnce(new Error("Save failed"));
		f.window.setAlwaysOnTop
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(new Error("Rollback failed"));
		await expect(
			setMainWindowPinned(f.window, f.settings, true),
		).rejects.toBeInstanceOf(AggregateError);
		await setMainWindowPinned(f.window, f.settings, true);
		expect(f.pinned()).toBe(true);
		expect(f.level()).toBe(true);
	});

	it("serializes permission demotion after the complete pin transaction", async () => {
		const f = fixture();
		let finish!: () => void;
		const saving = new Promise<void>((resolve) => {
			finish = resolve;
		});
		f.settings.set.mockImplementationOnce(async () => saving);
		const pin = setMainWindowPinned(f.window, f.settings, true);
		const demote = enqueueWindowLevelUpdate(() =>
			f.window.setAlwaysOnTop(false),
		);
		for (let index = 0; index < 10; index++) await Promise.resolve();
		expect(f.window.setAlwaysOnTop.mock.calls).toEqual([[true]]);
		finish();
		await Promise.all([pin, demote]);
		expect(f.window.setAlwaysOnTop.mock.calls).toEqual([[true], [false]]);
	});
});
