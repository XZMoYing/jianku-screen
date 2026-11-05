// Pure geometry for split-mode snapping on the timeline. All times are in
// output (rendered) time, the domain every non-clip track stores directly and
// the clip track draws in; the caller converts the pixel snap radius via
// secsPerPixel. Targets within EDGE_EPSILON of the hovered clip's edges are
// rejected — snapping there would cut off a near-zero-length piece.

import type { TimelineConfiguration } from "~/utils/tauri";

export const SPLIT_SNAP_PX = 7;
export const SPLIT_EDGE_EPSILON = 0.05;

export type SplitSnapResult = {
	time: number;
	snapped: { time: number } | null;
};

const BOUNDARY_TRACKS = [
	"styleSegments",
	"imageSegments",
	"zoomSegments",
	"sceneSegments",
	"camera3dSegments",
	"textSegments",
	"maskSegments",
	"captionSegments",
	"keyboardSegments",
	"audioSegments",
] as const;

export function overlayBoundaryTargets(
	timeline: TimelineConfiguration | null | undefined,
	exclude?: object,
) {
	const targets: number[] = [];
	if (timeline) {
		for (const key of BOUNDARY_TRACKS) {
			for (const segment of timeline[key] ?? []) {
				if (segment !== exclude) targets.push(segment.start, segment.end);
			}
		}
	}
	return targets;
}

export function nearestTimelineSnap(
	edges: readonly number[],
	targets: readonly number[],
	radius: number,
	allowed: (delta: number, edge: number, target: number) => boolean,
) {
	let best: { time: number; delta: number } | null = null;
	for (const target of targets) {
		if (!Number.isFinite(target)) continue;
		for (let edge = 0; edge < edges.length; edge++) {
			const delta = target - edges[edge];
			const distance = Math.abs(delta);
			if (!Number.isFinite(distance) || distance > radius) continue;
			if (
				best &&
				(distance > Math.abs(best.delta) ||
					(distance === Math.abs(best.delta) && target >= best.time))
			)
				continue;
			if (allowed(delta, edge, target)) best = { time: target, delta };
		}
	}
	return best;
}

export function snapSplitTime(
	raw: number,
	clipStart: number,
	clipEnd: number,
	radius: number,
	timeline: TimelineConfiguration | null | undefined,
	playhead: number,
	additionalTargets: readonly number[] = [],
): SplitSnapResult {
	const best = nearestTimelineSnap(
		[raw],
		[playhead, ...overlayBoundaryTargets(timeline), ...additionalTargets],
		radius,
		(_delta, _edge, time) =>
			time >= clipStart + SPLIT_EDGE_EPSILON &&
			time <= clipEnd - SPLIT_EDGE_EPSILON,
	);
	return best === null
		? { time: raw, snapped: null }
		: { time: best.time, snapped: { time: best.time } };
}
