import { describe, expect, it } from "vitest";
import {
	editorBindings,
	editorKeymapDefaults,
	keyStroke,
} from "~/utils/editor-keymap";
import { splitCaptionAt } from "./captions";
import { overlaySplitTargets, overlayTrimRange } from "./playhead-edits";

describe("playhead commands", () => {
	it("only splits selected clips that cross the playhead and preserves track-specific limits", () => {
		const adjacent = { start: 3, end: 5 };
		const left = { start: 0, end: 1.9 };
		const first = { start: 1, end: 4 };
		const tracks = [left, first, adjacent];
		expect(overlaySplitTargets("text", tracks, 2)).toEqual([first]);
		expect(overlaySplitTargets("text", tracks, 2, [0, 2])).toEqual([]);
		expect(overlaySplitTargets("caption", tracks, 1.45, [1])).toEqual([]);
		expect(overlaySplitTargets("keyboard", tracks, 1.45, [1])).toEqual([first]);
		expect(
			overlaySplitTargets("zoom", [{ ...first, sourceSlices: [{}] }], 2),
		).toEqual([]);
	});

	it("only needs the kept side of a trim to meet the minimum duration", () => {
		const row = { start: 1, end: 4 };
		expect(overlayTrimRange("text", row, "start", 1.1)).toEqual({
			start: 1.1,
			end: 4,
		});
		expect(overlayTrimRange("text", row, "end", 1.1)).toBeNull();
		expect(overlayTrimRange("text", row, "end", Number.NaN)).toBeNull();
	});

	it("partitions caption words and retains the original source identity on the left", () => {
		const segment = {
			id: "source",
			start: 2,
			end: 6,
			text: "one two",
			words: [
				{ start: 2, end: 3, text: "one" },
				{ start: 4, end: 5, text: "two" },
			],
		};
		const result = splitCaptionAt(segment, 3.5, "right");
		expect(
			result?.map(({ id, start, end, text }) => ({ id, start, end, text })),
		).toEqual([
			{ id: "source", start: 2, end: 3.5, text: "one" },
			{ id: "right", start: 3.5, end: 6, text: "two" },
		]);
		expect(segment.start).toBe(2);
	});

	it("adds the Final Cut trim and multi-track split shortcuts without conflicting with single split", () => {
		const bindings = editorBindings(editorKeymapDefaults, true);
		expect(bindings.split).toEqual([keyStroke("KeyB", { meta: true })]);
		expect(bindings.splitAll).toEqual([
			keyStroke("KeyB", { meta: true, shift: true }),
		]);
		expect(bindings.trimLeft).toEqual([
			keyStroke("BracketLeft", { alt: true }),
		]);
		expect(bindings.trimRight).toEqual([
			keyStroke("BracketRight", { alt: true }),
		]);
		expect(bindings.stepForward).toEqual([keyStroke("ArrowRight")]);
	});
});
