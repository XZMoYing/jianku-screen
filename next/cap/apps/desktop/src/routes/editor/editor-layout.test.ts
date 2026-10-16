import { describe, expect, it } from "vitest";
import {
	DEFAULT_TIMELINE_HEIGHT,
	editorInspectorWidth,
	editorVerticalLayout,
} from "./editor-layout";

describe("editor startup layout", () => {
	it("preserves player space when the startup split is constrained", () => {
		for (const height of [360, 560, 720, 1000]) {
			const loading = editorVerticalLayout(height, DEFAULT_TIMELINE_HEIGHT);
			expect(loading.timelineHeight).toBeLessThanOrEqual(
				DEFAULT_TIMELINE_HEIGHT,
			);
			expect(
				loading.timelineHeight + loading.minPlayerHeight,
			).toBeLessThanOrEqual(height);
		}
	});
	it("keeps the saved user split when it fits", () => {
		expect(editorVerticalLayout(900, 410).timelineHeight).toBe(410);
	});
	it("handles a collapsed window without negative dimensions", () => {
		expect(editorVerticalLayout(0, 260)).toEqual({
			minPlayerHeight: 0,
			timelineHeight: 0,
		});
	});
});

describe("editor inspector split", () => {
	it("keeps both panels usable at wide and compact sizes", () => {
		for (const available of [620, 900, 1680]) {
			for (const preferred of [-20, 352, 2000, Number.NaN]) {
				const width = editorInspectorWidth(available, preferred);
				expect(width).toBeGreaterThanOrEqual(292);
				expect(available - 32 - width).toBeGreaterThanOrEqual(280);
				expect(width).toBeLessThanOrEqual(560);
			}
		}
	});
	it("retains the user width when space returns", () => {
		expect(editorInspectorWidth(1600, 480)).toBe(480);
		expect(editorInspectorWidth(620, 480)).toBe(308);
		expect(editorInspectorWidth(1600, 480)).toBe(480);
	});
});
