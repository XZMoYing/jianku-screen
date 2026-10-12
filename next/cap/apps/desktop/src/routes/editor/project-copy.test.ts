import { describe, expect, it, vi } from "vitest";
import { savePortableCopy } from "./project-copy";

function fixture() {
	return {
		flush: vi.fn(async () => {}),
		pickDestination: vi.fn(
			async (): Promise<string | null> => "/copies/demo.cap",
		),
		copy: vi.fn(async (path: string) => path),
		open: vi.fn(async (_path: string) => {}),
		onSaved: vi.fn((_path: string) => {}),
	};
}

describe("portable project save boundary", () => {
	it("cancels without writing or opening a project", async () => {
		const options = fixture();
		options.pickDestination.mockResolvedValue(null);
		await expect(savePortableCopy(options)).resolves.toBeNull();
		expect(options.flush).not.toHaveBeenCalled();
		expect(options.copy).not.toHaveBeenCalled();
		expect(options.open).not.toHaveBeenCalled();
		expect(options.onSaved).not.toHaveBeenCalled();
	});

	it("waits for current edits before copying and announces the saved path before opening", async () => {
		const options = fixture();
		let finish = () => {};
		let disk = "old edits";
		options.flush.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					finish = () => {
						disk = "latest edits";
						resolve();
					};
				}),
		);
		options.copy.mockImplementation(async (path) => {
			expect(disk).toBe("latest edits");
			return path;
		});
		options.open.mockImplementation(async (path) => {
			expect(options.onSaved).toHaveBeenCalledWith(path);
		});
		const saved = savePortableCopy(options);
		await Promise.resolve();
		expect(options.copy).not.toHaveBeenCalled();
		finish();
		await expect(saved).resolves.toBe("/copies/demo.cap");
		expect(options.copy).toHaveBeenCalledOnce();
		expect(options.open).toHaveBeenCalledOnce();
	});

	it("does not copy or open after a failed save", async () => {
		const options = fixture();
		options.flush.mockRejectedValue(new Error("read-only volume"));
		await expect(savePortableCopy(options)).rejects.toThrow("read-only volume");
		expect(options.copy).not.toHaveBeenCalled();
		expect(options.open).not.toHaveBeenCalled();
		expect(options.onSaved).not.toHaveBeenCalled();
	});

	it("does not report success or open after a failed copy", async () => {
		const options = fixture();
		options.copy.mockRejectedValue(new Error("missing image"));
		await expect(savePortableCopy(options)).rejects.toThrow("missing image");
		expect(options.open).not.toHaveBeenCalled();
		expect(options.onSaved).not.toHaveBeenCalled();
	});

	it("keeps the successful save notification when the editor cannot open", async () => {
		const options = fixture();
		options.open.mockRejectedValue(new Error("editor unavailable"));
		await expect(savePortableCopy(options)).rejects.toThrow(
			"editor unavailable",
		);
		expect(options.onSaved).toHaveBeenCalledWith("/copies/demo.cap");
	});
});
