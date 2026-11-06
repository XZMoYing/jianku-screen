import { describe, expect, it } from "vitest";
import type { MainTrackGaps } from "~/utils/tauri";
import {
	type ClipTransition,
	clipTimelineDuration,
	clipTimelineOffsets,
} from "./clip-transitions";
import {
	appendMainTrackClip,
	closeMainTrackGaps,
	cutPositionedMainTrackRange,
	deletePositionedMainTrackClip,
	movePositionedMainTrackClip,
	planMainTrackMove,
	reorderPositionedMainTrackClip,
	setPositionedMainTrackSpeed,
	setPositionedMainTrackTransition,
	trimPositionedMainTrackClip,
} from "./main-track-edit";

const clip = (id: string, start = 0, end = 2) => ({
	id,
	start,
	end,
	timescale: 1,
});
const fixture = (mainTrackGaps?: MainTrackGaps) => ({
	segments: [clip("a"), clip("b"), clip("c")],
	transitions: [] as ClipTransition[],
	mainTrackGaps,
});
const starts = (track: ReturnType<typeof fixture>) =>
	clipTimelineOffsets(track.segments, track.transitions, track.mainTrackGaps);
const length = (track: ReturnType<typeof fixture>) =>
	clipTimelineDuration(track.segments, track.transitions, track.mainTrackGaps);

describe("positioned main track edits", () => {
	it("moves a clip into a gap and leaves all other clips and timeline end in place", () => {
		const track = fixture({ beforeClip: { c: 3 } });
		const move = planMainTrackMove(track, "a");
		expect(move?.place(5)).toBe(5);
		expect(move?.place(3)).toBe(4);
		expect(movePositionedMainTrackClip(track, "a", 5)).toBe(true);
		expect(track.segments.map(({ id }) => id)).toEqual(["b", "a", "c"]);
		expect(starts(track)).toEqual([2, 5, 7]);
		expect(length(track)).toBe(9);
	});

	it("deletes without shifting the remaining clips and appends after the trailing gap", () => {
		const track = fixture();
		expect(deletePositionedMainTrackClip(track, 0)).toBe(true);
		expect(deletePositionedMainTrackClip(track, 1)).toBe(true);
		expect(starts(track)).toEqual([2]);
		expect(length(track)).toBe(6);
		expect(appendMainTrackClip(track, clip("d"))).toBe(true);
		expect(starts(track)).toEqual([2, 6]);
		expect(length(track)).toBe(8);
	});

	it("trims either edge and keeps the opposite edge and other clips fixed", () => {
		const track = fixture();
		expect(trimPositionedMainTrackClip(track, "b", "start", 0.5)).toBe(true);
		expect(starts(track)).toEqual([0, 2.5, 4]);
		expect(trimPositionedMainTrackClip(track, "b", "end", 1.5)).toBe(true);
		expect(starts(track)).toEqual([0, 2.5, 4]);
		expect(track.mainTrackGaps).toEqual({ beforeClip: { b: 0.5, c: 0.5 } });
		expect(trimPositionedMainTrackClip(track, "b", "end", 2.25)).toBe(false);
		expect(setPositionedMainTrackSpeed(track, 1, 0.5)).toBe(false);
		expect(setPositionedMainTrackSpeed(track, 1, 2)).toBe(true);
		expect(starts(track)).toEqual([0, 2.5, 4]);
	});

	it("keeps only the transitions still connected to the same neighboring clips", () => {
		const track = fixture({ beforeClip: { c: 2 } });
		track.transitions = [
			{ segmentIndex: 1, duration: 0.5, type: "cross-fade" },
		];
		expect(movePositionedMainTrackClip(track, "c", 7)).toBe(true);
		expect(track.transitions).toHaveLength(1);
		expect(starts(track)).toEqual([0, 1.5, 7]);
		expect(movePositionedMainTrackClip(track, "a", 9)).toBe(true);
		expect(starts(track)).toEqual([1.5, 7, 9]);
		expect(track.transitions).toEqual([]);
	});

	it("uses only the requested list slot and closes existing gaps on explicit packing", () => {
		const track = fixture();
		expect(reorderPositionedMainTrackClip(track, "c", 1)).toBe(false);
		expect(reorderPositionedMainTrackClip(track, "a", 3)).toBe(true);
		expect(starts(track)).toEqual([2, 4, 6]);
		closeMainTrackGaps(track);
		expect(starts(track)).toEqual([0, 2, 4]);
		expect(track.mainTrackGaps).toBeUndefined();
	});

	it("applies a transition and a transcript cut without moving later clips", () => {
		const track = fixture({ beforeClip: { c: 2 } });
		expect(
			setPositionedMainTrackTransition(track, 1, {
				type: "cross-fade",
				duration: 0.5,
			}),
		).toBe(true);
		expect(starts(track)).toEqual([0, 1.5, 6]);
		expect(cutPositionedMainTrackRange(track, 1, 2.5, 3)).toBe(true);
		expect(starts(track)).toEqual([0, 1.5, 3, 6]);
		expect(track.transitions).toEqual([
			{ segmentIndex: 1, type: "cross-fade", duration: 0.5 },
		]);
		expect(length(track)).toBe(8);
	});
});
