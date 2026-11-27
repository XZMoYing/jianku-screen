import { describe, expect, it } from "vitest";

import {
	type ClipTransition,
	clampTransitionDuration,
	clipCutPreservesTransitionGeometry,
	clipEndOnOutput,
	clipSourceTimeAt,
	clipSplitAt,
	clipTimelineDuration,
	clipTimelineOffsets,
	getClipTransition,
	maxTransitionDuration,
	normalizeClipTransitions,
	rangeIntersectsClipTransition,
	rippleTimelineTrack,
	timelineShiftAfterClipDurationChange,
	transitionsAfterClipDelete,
	transitionsAfterClipMove,
	transitionsAfterClipSplit,
} from "./clip-transitions";

const segment = (duration: number) => ({
	start: 0,
	end: duration,
	timescale: 1,
});

const transition = (
	segmentIndex: number,
	duration: number,
	type: ClipTransition["type"] = "cross-fade",
): ClipTransition => ({ segmentIndex, type, duration });

describe("clip transitions", () => {
	it("lays out leading and internal gaps and ignores a legacy blank tail", () => {
		const segments = [
			{ ...segment(2), id: "a" },
			{ ...segment(3), id: "b", start: 4, end: 7 },
		];
		const transitions = [transition(1, 0.5)];
		const gaps = { beforeClip: { a: 1, b: 0.75, removed: 99 }, trailing: 0.5 };
		expect(clipTimelineOffsets(segments, transitions, gaps)).toEqual([1, 3.75]);
		expect(clipTimelineDuration(segments, transitions, gaps)).toBe(6.75);
		expect(getClipTransition(segments, transitions, 1, gaps)).toBeNull();
		for (const time of [0, 0.5, 3, 3.5, 6.75, 7]) {
			expect(clipSourceTimeAt(segments, transitions, time, gaps)).toBeNull();
		}
		expect(clipSourceTimeAt(segments, transitions, 3.75, gaps)).toEqual({
			segmentIndex: 1,
			recordingSegment: 0,
			sourceTime: 4,
		});
	});

	it("splits only a requested clip under the playhead and rejects gaps, edges and transition overlap", () => {
		const segments = [
			{ ...segment(4), id: "a" },
			{ ...segment(8), start: 2, end: 10, timescale: 2, id: "b" },
		];
		const gaps = { beforeClip: { b: 2 } };
		expect(clipSplitAt(segments, [], 8, gaps, [0])).toBeNull();
		expect(clipSplitAt(segments, [], 5, gaps)).toBeNull();
		expect(clipSplitAt(segments, [], 6, gaps)).toBeNull();
		expect(clipSplitAt(segments, [], 8, gaps, [1])).toEqual({
			index: 1,
			sourceTime: 6,
		});
		expect(clipSplitAt(segments, [transition(1, 1)], 3.25)).toBeNull();
	});

	it("keeps a legacy timeline unchanged", () => {
		const segments = [segment(4), segment(6), segment(2)];

		expect(clipTimelineOffsets(segments, [])).toEqual([0, 4, 10]);
		expect(clipTimelineDuration(segments, [])).toBe(12);
	});

	it("keeps a fullscreen title at the exact project end outside the last video box", () => {
		const segments = [segment(3)];
		expect(clipEndOnOutput([[3, 4]], segments, 0, 3)).toBe(3);
		expect(clipEndOnOutput([[2, 4]], segments, 0, 3)).toBe(5);
	});

	it("overlaps an incoming clip by its transition duration", () => {
		const segments = [segment(4), segment(6), segment(2)];
		const transitions = [
			transition(1, 1),
			transition(2, 0.5, "fade-through-black"),
		];

		expect(clipTimelineOffsets(segments, transitions)).toEqual([0, 3, 8.5]);
		expect(clipTimelineDuration(segments, transitions)).toBe(10.5);
		expect(getClipTransition(segments, transitions, 1)).toEqual({
			segmentIndex: 1,
			type: "cross-fade",
			duration: 1,
		});
	});

	it("clamps overlap to half of the shorter adjacent clip", () => {
		const previous = segment(8);
		const current = segment(1);

		expect(maxTransitionDuration(previous, current)).toBe(0.5);
		expect(clampTransitionDuration(3, previous, current)).toBe(0.5);
	});

	it("rejects transitions without two usable adjacent clips", () => {
		const segments = [segment(0.04), segment(2)];
		const transitions = [transition(1, 0.5)];

		expect(getClipTransition(segments, transitions, 0)).toBeNull();
		expect(getClipTransition(segments, transitions, 1)).toBeNull();
		expect(clipTimelineDuration(segments, transitions)).toBe(2.04);
	});

	it("uses the last transition for a duplicated boundary", () => {
		const segments = [segment(4), segment(4)];
		const transitions = [transition(1, 0.5), transition(1, 1)];

		expect(getClipTransition(segments, transitions, 1)?.duration).toBe(1);
	});

	it("normalizes stored durations so later clip edits cannot re-expand them", () => {
		const transitions = normalizeClipTransitions(
			[segment(8), segment(1)],
			[transition(1, 3)],
		);

		expect(transitions).toEqual([transition(1, 0.5)]);
		expect(
			getClipTransition([segment(8), segment(8)], transitions, 1)?.duration,
		).toBe(0.5);
	});

	it("ripples tracks without detaching items that start on the cut", () => {
		const track = [
			{ start: 3, end: 4 },
			{ start: 2.75, end: 3.25 },
			{ start: 2, end: 3 },
		];

		rippleTimelineTrack(track, 3, -0.5);

		expect(track).toEqual([
			{ start: 2.5, end: 3.5 },
			{ start: 2.75, end: 2.75 },
			{ start: 2, end: 3 },
		]);
	});

	it("reaches the full speed-change shift at an outgoing transition", () => {
		const oldSegments = [segment(10), segment(5)];
		const transitions = [transition(1, 2)];
		const newSegments = [{ ...segment(10), timescale: 2 }, segment(5)];
		const oldOffsets = clipTimelineOffsets(oldSegments, transitions);
		const newOffsets = clipTimelineOffsets(newSegments, transitions);

		expect(oldOffsets[1]).toBe(8);
		expect(newOffsets[1]).toBe(3);
		expect(
			timelineShiftAfterClipDurationChange(
				8,
				oldOffsets[0],
				newOffsets[0],
				oldOffsets[0],
				oldOffsets[1],
				newOffsets[1],
			),
		).toBe(-5);
	});

	it("moves tracks with an incoming transition that becomes shorter", () => {
		const oldSegments = [segment(10), segment(1)];
		const transitions = [transition(1, 0.5)];
		const newSegments = [segment(10), { ...segment(1), timescale: 2 }];
		const oldOffsets = clipTimelineOffsets(oldSegments, transitions);
		const newOffsets = clipTimelineOffsets(newSegments, transitions);

		expect(oldOffsets[1]).toBe(9.5);
		expect(newOffsets[1]).toBe(9.75);
		expect(
			timelineShiftAfterClipDurationChange(
				9.5,
				oldOffsets[1],
				newOffsets[1],
				10,
				10.5,
				10.25,
			),
		).toBe(0.25);
		expect(
			timelineShiftAfterClipDurationChange(
				10,
				oldOffsets[1],
				newOffsets[1],
				10,
				10.5,
				10.25,
			),
		).toBe(0);
	});

	it("uses the full shift when incoming and outgoing transitions share a boundary", () => {
		expect(timelineShiftAfterClipDurationChange(4, 3, 3, 4, 4, 6)).toBe(2);
	});

	it("detects only ranges inside active transition overlaps", () => {
		const segments = [segment(4), segment(4)];
		const transitions = [transition(1, 1)];

		expect(
			rangeIntersectsClipTransition(segments, transitions, 3.25, 3.5),
		).toBe(true);
		expect(rangeIntersectsClipTransition(segments, transitions, 2.5, 3)).toBe(
			false,
		);
		expect(rangeIntersectsClipTransition(segments, transitions, 4, 4.5)).toBe(
			false,
		);
	});

	it("rejects cuts that would force an adjacent transition to shrink", () => {
		const segments = [segment(4), segment(4)];
		const transitions = [transition(1, 1)];

		expect(
			clipCutPreservesTransitionGeometry(segments, transitions, 1, 4.1, 4.2),
		).toBe(false);
		expect(
			clipCutPreservesTransitionGeometry(segments, transitions, 1, 5.1, 5.2),
		).toBe(true);
	});

	it("repairs transition indices after clip splits and deletes", () => {
		const transitions = [transition(1, 0.5), transition(3, 0.75)];

		expect(transitionsAfterClipSplit(transitions, 1)).toEqual([
			transition(1, 0.5),
			transition(4, 0.75),
		]);
		expect(transitionsAfterClipDelete(transitions, 1)).toEqual([
			transition(2, 0.75),
		]);
	});

	it("preserves only clip adjacencies that survive a reorder", () => {
		const transitions = [transition(1, 0.5), transition(3, 0.75)];

		expect(transitionsAfterClipMove(4, transitions, 1, 3)).toEqual({
			kept: [transition(2, 0.75)],
			dropped: [transition(1, 0.5)],
		});
	});
});
