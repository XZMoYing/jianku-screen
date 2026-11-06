import type { TimelineSnapping } from "./context";
import { nearestTimelineSnap, SPLIT_SNAP_PX } from "./split-snapping";

export type TimelineRange = { start: number; end: number };
export type TimelineRangeEdge = "start" | "end" | "move";

export function sameTimelineRange(a: TimelineRange, b: TimelineRange) {
	return a.start === b.start && a.end === b.end;
}

export function createTimelineRangeDrag(
	snapping: TimelineSnapping | undefined,
	segment: TimelineRange,
	edge: TimelineRangeEdge,
	{ prevEnd, nextStart }: { prevEnd: number; nextStart: number },
	minDuration: number,
	playhead: number,
) {
	const original = { start: segment.start, end: segment.end };
	const anchors =
		edge === "move" ? [original.start, original.end] : [original[edge]];
	const targets = snapping ? [playhead, ...snapping.targets(segment)] : [];
	let min: number;
	let max: number;
	if (edge === "start") {
		min = prevEnd - original.start;
		max = Math.max(
			min,
			Math.min(original.end - minDuration, nextStart - minDuration) -
				original.start,
		);
	} else if (edge === "end") {
		min = original.start + minDuration - original.end;
		max = Math.max(min, nextStart - original.end);
	} else {
		const left = prevEnd - original.start;
		const right = nextStart - original.end;
		min = Math.min(left, right);
		max = Math.max(left, right);
	}

	return {
		original,
		edit(
			delta: number,
			secondsPerPixel: number,
			bypass: boolean,
		): TimelineRange {
			const snap =
				snapping?.enabled() && !bypass
					? nearestTimelineSnap(
							anchors.map((anchor) => anchor + delta),
							targets,
							SPLIT_SNAP_PX * secondsPerPixel,
							(shift) =>
								delta + shift >= min - 1e-7 && delta + shift <= max + 1e-7,
						)
					: null;
			snapping?.setGuide(snap?.time ?? null);
			const offset = Math.min(max, Math.max(min, delta + (snap?.delta ?? 0)));
			return {
				start: edge === "end" ? original.start : original.start + offset,
				end: edge === "start" ? original.end : original.end + offset,
			};
		},
		clear() {
			snapping?.setGuide(null);
		},
	};
}
