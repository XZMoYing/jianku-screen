import * as dialog from "@tauri-apps/plugin-dialog";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	displayRecordingName,
	handleRecordingResult,
	isRecordingStartCancelled,
	runRecordingStopRequest,
} from "./recording";

vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ message: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));
vi.mock("./tauri", () => ({ commands: {} }));

describe("recording start cancellation", () => {
	beforeEach(() => vi.clearAllMocks());

	it.each([
		"Recording cancelled before starting.",
		new Error("Recording cancelled before starting."),
	])("does not show another error after the user cancels", async (error) => {
		await handleRecordingResult(Promise.reject(error), undefined);
		expect(dialog.message).not.toHaveBeenCalled();
	});

	it.each([
		"Not enough storage to start recording.",
		"Recording cancelled before starting. Cleanup failed.",
		"Recording cancelled",
	])("still shows a real start failure: %s", async (message) => {
		expect(isRecordingStartCancelled(message)).toBe(false);
		await handleRecordingResult(Promise.reject(new Error(message)), undefined);
		expect(dialog.message).toHaveBeenCalledWith(message, {
			title: "录制启动失败",
			kind: "error",
		});
	});
});

describe("legacy recording display names", () => {
	it("shows the local brand and localized date without modifying stored metadata", () => {
		expect(displayRecordingName("Cap 2026-10-18 at 19.16.30")).toBe(
			"简库镜传 Next 2026-10-18 19.16.30",
		);
	});
	it("retains meaningful words in custom titles", () => {
		expect(displayRecordingName("Cap demo at school")).toBe(
			"简库镜传 Next demo at school",
		);
	});
	it("does not alter custom titles which only share part of the old brand", () => {
		for (const name of ["Capital Demo", "新演示 at 19.16.30", "我的演示"])
			expect(displayRecordingName(name)).toBe(name);
	});
});

describe("recording stop requests", () => {
	it("releases a failed request so Stop can be retried while retaining the error", async () => {
		let pending = true;
		let error: unknown;
		const failure = new Error("Windows are still restoring");
		const stop = vi
			.fn()
			.mockRejectedValueOnce(failure)
			.mockResolvedValueOnce(undefined);
		const options = {
			stop,
			isCurrent: () => pending,
			onError: (value: unknown) => {
				error = value;
			},
			onSettled: () => {
				pending = false;
			},
		};
		await runRecordingStopRequest(options);
		expect(pending).toBe(false);
		expect(error).toBe(failure);
		pending = true;
		await runRecordingStopRequest(options);
		expect(stop).toHaveBeenCalledTimes(2);
		expect(pending).toBe(false);
		expect(error).toBe(failure);
	});

	it.each([false, true])(
		"ignores a stale completion after a new recording starts (failure: %s)",
		async (fails) => {
			let finish: () => void = () => {};
			const stopped = new Promise<void>((resolve) => {
				finish = resolve;
			});
			let current = true;
			const onError = vi.fn();
			const onSettled = vi.fn();
			const pending = runRecordingStopRequest({
				stop: async () => {
					await stopped;
					if (fails) throw new Error("Old stop error");
				},
				isCurrent: () => current,
				onError,
				onSettled,
			});
			current = false;
			finish();
			await pending;
			expect(onError).not.toHaveBeenCalled();
			expect(onSettled).not.toHaveBeenCalled();
		},
	);
});
