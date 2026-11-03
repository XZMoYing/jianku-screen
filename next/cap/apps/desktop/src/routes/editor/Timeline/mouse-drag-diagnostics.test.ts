import { createRoot, createSignal } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { recordTimelineGesture } from "./gesture-diagnostics";
import { createTimelineMouseDrag } from "./mouse-drag";

vi.mock("./gesture-diagnostics", () => ({
	recordTimelineGesture: vi.fn(async () => {}),
}));
let dispose: (() => void) | undefined;
afterEach(() => {
	dispose?.();
	vi.clearAllMocks();
});
it.each([
	"release",
	"blur",
	"escape",
	"invalid",
	"buttons",
	"dispose",
	"superseded",
	"history",
] as const)("records the actual %s trigger and finishes once", (cause) => {
	const [valid, setValid] = createSignal(true);
	const start = createRoot((end) => {
		dispose = end;
		return createTimelineMouseDrag();
	});
	const finish = vi.fn();
	start(() => ({
		diagnostics: { kind: "keyboard", snapshot: () => ({ valid: valid() }) },
		isValid: valid,
		update: () => {},
		finish,
	}));
	if (cause === "release")
		window.dispatchEvent(new MouseEvent("mouseup", { button: 0 }));
	if (cause === "blur") window.dispatchEvent(new Event("blur"));
	if (cause === "escape")
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
	if (cause === "invalid") setValid(false);
	if (cause === "buttons")
		window.dispatchEvent(new MouseEvent("mousemove", { buttons: 0 }));
	if (cause === "dispose") dispose?.();
	if (cause === "superseded") start(() => null);
	if (cause === "history")
		window.dispatchEvent(
			new KeyboardEvent("keydown", { key: "z", code: "KeyZ", metaKey: true }),
		);
	expect(recordTimelineGesture).toHaveBeenCalledWith(
		expect.objectContaining({
			cause,
			snapshot: { valid: cause !== "invalid" },
		}),
	);
	window.dispatchEvent(new MouseEvent("mousemove", { buttons: 1 }));
	window.dispatchEvent(new MouseEvent("mouseup", { button: 0 }));
	expect(finish).toHaveBeenCalledTimes(1);
	expect(recordTimelineGesture).toHaveBeenCalledTimes(1);
});
it("finishes safely if the optional diagnostic snapshot is unavailable", () => {
	const start = createRoot((end) => {
		dispose = end;
		return createTimelineMouseDrag();
	});
	const finish = vi.fn();
	start(() => ({
		diagnostics: {
			kind: "keyboard",
			snapshot: () => {
				throw new Error("unavailable");
			},
		},
		isValid: () => true,
		update: () => {},
		finish,
	}));
	window.dispatchEvent(new Event("blur"));
	expect(finish).toHaveBeenCalledTimes(1);
	expect(recordTimelineGesture).toHaveBeenCalledWith(
		expect.objectContaining({ snapshot: { snapshotUnavailable: true } }),
	);
});
