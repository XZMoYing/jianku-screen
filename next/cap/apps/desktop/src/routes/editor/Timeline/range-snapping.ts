import type { TimelineSnapping } from "./context";
import { nearestTimelineSnap, SPLIT_SNAP_PX } from "./split-snapping";

export type TimelineRange = { start: number; end: number };
export type TimelineRangeEdge = "start" | "end" | "move";

export function sameTimelineRange(a: TimelineRange, b: TimelineRange) {
	return a.start === b.start && a.end === b.end;
}

export function createTimelineSnapGesture(
	snapping: TimelineSnapping | undefined,
	segment: TimelineRange,
	playhead: number,
) {
	const original = { start: segment.start, end: segment.end };
	const targets = snapping ? [playhead, ...snapping.targets(segment)] : [];
	return {
		original,
		edit<T extends TimelineRange>(
			edge: TimelineRangeEdge,
			delta: number,
			secondsPerPixel: number,
			bypass: boolean,
			constrain: (delta: number) => T,
		): T {
			const sides = edge === "move" ? (["start", "end"] as const) : [edge];
			const snap =
				snapping?.enabled() && !bypass
					? nearestTimelineSnap(
							sides.map((side) => original[side] + delta),
							targets,
							SPLIT_SNAP_PX * secondsPerPixel,
							(shift, side, target) =>
								Math.abs(constrain(delta + shift)[sides[side]] - target) < 1e-7,
						)
					: null;
			snapping?.setGuide(snap?.time ?? null);
			return constrain(delta + (snap?.delta ?? 0));
		},
		clear() {
			snapping?.setGuide(null);
		},
	};
}

export function createOrderedTimelineRangeDrag(
	snapping: TimelineSnapping | undefined,
	segment: TimelineRange,
	edge: TimelineRangeEdge,
	items: readonly TimelineRange[],
	duration: number,
	minDuration: number,
	playhead: number,
	includeTouchingEnd = true,
) {
	const snap = createTimelineSnapGesture(snapping, segment, playhead);
	const { original } = snap;
	const index = items.indexOf(segment);
	const before = items[index - 1];
	const after = items[index + 1];
	let minStart = before?.end ?? 0;
	if (edge === "start") {
		minStart = 0;
		for (let index = items.length - 1; index >= 0; index--) {
			if (items[index].end <= original.start) {
				minStart = items[index].end;
				break;
			}
		}
	}
	const maxEnd =
		edge === "end"
			? (items.find(
					(item) =>
						item !== segment &&
						(includeTouchingEnd
							? item.start >= original.end
							: item.start > original.end),
				)?.start ?? duration)
			: (after?.start ?? duration);

	function constrain(delta: number) {
		if (edge === "start")
			return {
				start: Math.min(
					original.end - minDuration,
					Math.max(minStart, original.start + delta),
				),
				end: original.end,
			};
		if (edge === "end")
			return {
				start: original.start,
				end: Math.min(
					maxEnd,
					Math.max(original.start + minDuration, original.end + delta),
				),
			};
		let offset = delta;
		if (original.start + offset < minStart) offset = minStart - original.start;
		else if (original.end + offset > maxEnd) offset = maxEnd - original.end;
		return { start: original.start + offset, end: original.end + offset };
	}

	return {
		original,
		edit: (delta: number, scale: number, bypass: boolean) =>
			snap.edit(edge, delta, scale, bypass, constrain),
		clear: snap.clear,
	};
}

export function createTimelineRangeDrag(
	snapping: TimelineSnapping | undefined,
	segment: TimelineRange,
	edge: TimelineRangeEdge,
	{ prevEnd, nextStart }: { prevEnd: number; nextStart: number },
	minDuration: number,
	playhead: number,
) {
	const snap = createTimelineSnapGesture(snapping, segment, playhead);
	const { original } = snap;
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
		edit(delta: number, secondsPerPixel: number, bypass: boolean) {
			return snap.edit(edge, delta, secondsPerPixel, bypass, (value) => {
				const offset = Math.min(max, Math.max(min, value));
				return {
					start: edge === "end" ? original.start : original.start + offset,
					end: edge === "start" ? original.end : original.end + offset,
				};
			});
		},
		clear: snap.clear,
	};
}
