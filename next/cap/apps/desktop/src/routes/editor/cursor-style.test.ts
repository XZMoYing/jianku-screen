import { describe, expect, it } from "vitest";
import {
	cursorStyleOrder,
	recordedCursorFamily,
	selectedCursorStyle,
} from "./cursor-style";

describe("cursor style selection", () => {
	it("accepts recordings that omit their empty cursor map", () => {
		expect(recordedCursorFamily({ type: "multiple" })).toBeUndefined();
		expect(
			recordedCursorFamily({ type: "multiple", cursors: {} }),
		).toBeUndefined();
		expect(
			recordedCursorFamily({
				type: "multiple",
				cursors: {
					arrow: {
						imagePath: "cursor.png",
						hotspot: { x: 0, y: 0 },
						shape: "MacOS|TahoeArrow",
					},
				},
			}),
		).toBe("tahoe");
	});

	it("keeps Default distinct from an explicit OS appearance", () => {
		expect(selectedCursorStyle("auto")).toBe("auto");
		expect(selectedCursorStyle("pointer")).toBe("auto");
		for (const style of ["macos", "tahoe", "windows", "circle"] as const) {
			expect(selectedCursorStyle(style)).toBe(style);
		}
	});

	it("offers Default first and every appearance on each platform", () => {
		for (const platform of ["macos", "windows", "linux"]) {
			const styles = cursorStyleOrder(platform);
			expect(styles[0]).toBe("auto");
			expect(new Set(styles)).toEqual(
				new Set(["auto", "macos", "tahoe", "windows", "circle"]),
			);
		}
	});
});
