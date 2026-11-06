import type { TimelineSegment } from "~/utils/tauri";
import {
	effectiveToOutput,
	type HoldWindow,
	heldTimeBefore,
} from "../timeline-holds";
import { nearestTimelineSnap, SPLIT_SNAP_PX } from "./split-snapping";

type ClipTrimEdge = "start" | "end";

type ClipTrimOptions = {
	clip: TimelineSegment;
	edge: ClipTrimEdge;
	effectiveStart: number;
	holds: HoldWindow[];
	sourceDuration: number;
	minSourceDuration: number;
	previous?: TimelineSegment;
	next?: TimelineSegment;
};

export function createClipTrim({
	clip,
	edge,
	effectiveStart,
	holds,
	sourceDuration,
	minSourceDuration,
	previous,
	next,
}: ClipTrimOptions) {
	const { start, end, timescale } = clip;
	const initial = clip[edge];
	const source = clip.recordingSegment ?? 0;
	const minimum = Math.min(end - start, minSourceDuration);
	const effectiveEdge =
		edge === "start"
			? effectiveStart
			: effectiveStart + (end - start) / timescale;
	const outputEdge = effectiveToOutput(holds, effectiveEdge);

	let min: number;
	let max: number;
	if (edge === "start") {
		min =
			previous &&
			(previous.recordingSegment ?? 0) === source &&
			previous.end <= start
				? Math.max(0, previous.end)
				: 0;
		max = end - minimum;
	} else {
		min = start + minimum;
		const nextLimit =
			next && (next.recordingSegment ?? 0) === source && next.start >= end
				? next.start
				: sourceDuration;
		max = Math.max(end, Math.min(sourceDuration, nextLimit));
	}

	function resolve(output: number) {
		const effective = output - heldTimeBefore(holds, output);
		const sourceTime = Math.min(
			max,
			Math.max(min, initial + (effective - effectiveEdge) * timescale),
		);
		return {
			sourceTime,
			outputTime: effectiveToOutput(
				holds,
				effectiveEdge + (sourceTime - initial) / timescale,
			),
		};
	}

	return {
		edit(deltaPixels: number, scale: number, targets: readonly number[]) {
			const output = outputEdge + deltaPixels * scale;
			const snap = nearestTimelineSnap(
				[output],
				targets,
				SPLIT_SNAP_PX * scale,
				(_delta, _edge, target) =>
					Math.abs(resolve(target).outputTime - target) < 1e-7,
			);
			return { ...resolve(snap?.time ?? output), guide: snap?.time ?? null };
		},
	};
}
