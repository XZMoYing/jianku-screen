import type { MainTrackGaps, TimelineSegment } from "~/utils/tauri";
import { newClipInstance } from "./clip-identity";
import {
	type ClipTransition,
	type ClipTransitionInput,
	clampTransitionDuration,
	clipDuration,
	clipGapBefore,
	clipTimelineDuration,
	clipTimelineOffsets,
	clipTrailingGap,
	clipTransitionMap,
	MIN_CLIP_TRANSITION_DURATION,
	maxTransitionDuration,
	normalizeClipTransitions,
} from "./clip-transitions";

type MainTrack = {
	segments: TimelineSegment[];
	transitions: ClipTransition[];
	mainTrackGaps?: MainTrackGaps;
};

const EPSILON = 1e-7;

export function hasMainTrackGaps(track: MainTrack | null | undefined) {
	return (
		!!track &&
		(clipTrailingGap(track.mainTrackGaps) > 0 ||
			track.segments.some(
				(clip) => clipGapBefore(clip, track.mainTrackGaps) > 0,
			))
	);
}

type Placement = { clip: TimelineSegment; start: number; previousId?: string };

function placements(track: MainTrack): Placement[] {
	const starts = clipTimelineOffsets(
		track.segments,
		track.transitions,
		track.mainTrackGaps,
	);
	return track.segments.map((clip, index) => ({ clip, start: starts[index] }));
}

function duration(track: MainTrack) {
	return clipTimelineDuration(
		track.segments,
		track.transitions,
		track.mainTrackGaps,
	);
}

function placementEnd(placement: Placement | undefined) {
	return placement ? placement.start + clipDuration(placement.clip) : 0;
}

function applyPlacements(
	track: MainTrack,
	next: Placement[],
	minimumEnd: number,
	requested?: { leftId: string; rightId: string; transition: ClipTransition },
) {
	const previousBoundaries = new Map<
		string,
		{ leftId: string; transition: ClipTransition }
	>();
	clipTransitionMap(
		track.segments,
		track.transitions,
		track.mainTrackGaps,
	).forEach((transition, index) => {
		const leftId = track.segments[index - 1]?.id;
		const rightId = track.segments[index]?.id;
		if (transition && leftId && rightId)
			previousBoundaries.set(rightId, { leftId, transition });
	});
	if (requested) previousBoundaries.set(requested.rightId, requested);
	const gaps: [string, number][] = [];
	const transitions: ClipTransition[] = [];
	for (let index = 0; index < next.length; index++) {
		const { clip, start } = next[index];
		const left = next[index - 1];
		const gap = start - placementEnd(left);
		if (
			!clip.id ||
			!Number.isFinite(start) ||
			start < -EPSILON ||
			!Number.isFinite(clipDuration(clip)) ||
			clipDuration(clip) <= 0
		)
			return false;
		if (gap > EPSILON) gaps.push([clip.id, gap]);
		if (gap >= -EPSILON) continue;
		const boundary = previousBoundaries.get(next[index].previousId ?? clip.id);
		const overlap = -gap;
		if (
			!left ||
			!boundary ||
			boundary.leftId !== (left.previousId ?? left.clip.id) ||
			overlap + EPSILON < MIN_CLIP_TRANSITION_DURATION ||
			overlap > maxTransitionDuration(left.clip, clip) + EPSILON
		)
			return false;
		transitions.push({
			...boundary.transition,
			segmentIndex: index,
			duration: overlap,
		});
	}
	const trailing = Math.max(0, minimumEnd - placementEnd(next.at(-1)));
	track.segments = next.map(({ clip }) => clip);
	track.transitions = transitions;
	track.mainTrackGaps =
		gaps.length || trailing > EPSILON
			? {
					...(gaps.length ? { beforeClip: Object.fromEntries(gaps) } : {}),
					...(trailing > EPSILON ? { trailing } : {}),
				}
			: undefined;
	return true;
}

export function closeMainTrackGaps(track: MainTrack) {
	track.transitions = normalizeClipTransitions(
		track.segments,
		track.transitions,
		track.mainTrackGaps,
	);
	track.mainTrackGaps = undefined;
}

export function appendMainTrackClip(track: MainTrack, clip: TimelineSegment) {
	const end = duration(track);
	return applyPlacements(
		track,
		[...placements(track), { clip, start: end }],
		end,
	);
}

export function deletePositionedMainTrackClip(track: MainTrack, index: number) {
	if (!track.segments[index] || track.segments.length < 2) return false;
	const next = placements(track);
	next.splice(index, 1);
	return applyPlacements(track, next, duration(track));
}

export function trimPositionedMainTrackClip(
	track: MainTrack,
	clipId: string,
	edge: "start" | "end",
	sourceTime: number,
) {
	const index = track.segments.findIndex((clip) => clip.id === clipId);
	if (index < 0 || !Number.isFinite(sourceTime)) return false;
	const next = placements(track);
	const { clip, start } = next[index];
	if (clip[edge] === sourceTime || sourceTime < 0) return false;
	next[index] = {
		clip: { ...clip, [edge]: sourceTime },
		start:
			edge === "start"
				? start + (sourceTime - clip.start) / clip.timescale
				: start,
	};
	return applyPlacements(track, next, duration(track));
}

export function setPositionedMainTrackSpeed(
	track: MainTrack,
	index: number,
	timescale: number,
) {
	const next = placements(track);
	const current = next[index];
	if (
		!current ||
		!Number.isFinite(timescale) ||
		timescale <= 0 ||
		current.clip.timescale === timescale
	)
		return false;
	next[index] = { ...current, clip: { ...current.clip, timescale } };
	return applyPlacements(track, next, duration(track));
}

export function setPositionedMainTrackTransition(
	track: MainTrack,
	index: number,
	input: ClipTransitionInput | null,
) {
	const next = placements(track);
	const left = next[index - 1];
	const right = next[index];
	if (
		!left?.clip.id ||
		!right?.clip.id ||
		right.start > placementEnd(left) + EPSILON
	)
		return false;
	const overlap = input
		? clampTransitionDuration(input.duration, left.clip, right.clip)
		: 0;
	if (input && overlap === 0) return false;
	const start = placementEnd(left) - overlap;
	next[index] = { ...right, start };
	const after = next[index + 1];
	if (
		after &&
		placementEnd(next[index]) >
			Math.max(placementEnd(right), after.start) + EPSILON
	)
		return false;
	return applyPlacements(
		track,
		next,
		duration(track),
		input
			? {
					leftId: left.clip.id,
					rightId: right.clip.id,
					transition: { ...input, segmentIndex: index, duration: overlap },
				}
			: undefined,
	);
}

export function cutPositionedMainTrackRange(
	track: MainTrack,
	index: number,
	start: number,
	end: number,
) {
	const next = placements(track);
	const placement = next[index];
	if (
		!placement ||
		!Number.isFinite(start) ||
		!Number.isFinite(end) ||
		start < placement.start - EPSILON ||
		end > placementEnd(placement) + EPSILON ||
		end <= start
	)
		return false;
	const { clip } = placement;
	const leftEnd = clip.start + (start - placement.start) * clip.timescale;
	const rightStart = clip.start + (end - placement.start) * clip.timescale;
	const retained: Placement[] = [];
	if (leftEnd > clip.start + EPSILON)
		retained.push({ ...placement, clip: { ...clip, end: leftEnd } });
	if (rightStart < clip.end - EPSILON) {
		const right = { ...clip, start: rightStart };
		retained.push({
			start: end,
			clip: retained.length ? newClipInstance(right) : right,
			previousId: clip.id ?? undefined,
		});
	}
	if (!retained.length && next.length === 1) return false;
	next.splice(index, 1, ...retained);
	return applyPlacements(track, next, duration(track));
}

function moveLayout(track: MainTrack, clipId: string) {
	const next = placements(track);
	const from = next.findIndex(({ clip }) => clip.id === clipId);
	if (from < 0) return null;
	const [moved] = next.splice(from, 1);
	const length = clipDuration(moved.clip);
	const ranges = Array.from({ length: next.length + 1 }, (_, index) => ({
		index,
		min: placementEnd(next[index - 1]),
		max: (next[index]?.start ?? Infinity) - length,
	})).filter(({ min, max }) => max + EPSILON >= min);
	return { next, moved, from, ranges, length };
}

export function planMainTrackMove(track: MainTrack, clipId: string) {
	const layout = moveLayout(track, clipId);
	if (!layout) return null;
	return {
		start: layout.moved.start,
		length: layout.length,
		place(requested: number) {
			let nearest = layout.moved.start;
			let distance = Infinity;
			for (const { min, max } of layout.ranges) {
				const start = Math.max(min, Math.min(max, requested));
				if (Math.abs(start - requested) < distance) {
					nearest = start;
					distance = Math.abs(start - requested);
				}
			}
			return nearest;
		},
	};
}

export function movePositionedMainTrackClip(
	track: MainTrack,
	clipId: string,
	start: number,
) {
	const layout = moveLayout(track, clipId);
	if (
		!layout ||
		!Number.isFinite(start) ||
		Math.abs(layout.moved.start - start) <= EPSILON
	)
		return false;
	const range = layout.ranges.find(
		({ min, max }) => start >= min - EPSILON && start <= max + EPSILON,
	);
	if (!range) return false;
	layout.next.splice(range.index, 0, {
		...layout.moved,
		start: Math.max(range.min, Math.min(range.max, start)),
	});
	return applyPlacements(track, layout.next, duration(track));
}

export function reorderPositionedMainTrackClip(
	track: MainTrack,
	clipId: string,
	insertionIndex: number,
) {
	const layout = moveLayout(track, clipId);
	if (!layout || !Number.isInteger(insertionIndex)) return false;
	const index = insertionIndex - (layout.from < insertionIndex ? 1 : 0);
	if (index === layout.from) return false;
	const range = layout.ranges.find((range) => range.index === index);
	return !!range && movePositionedMainTrackClip(track, clipId, range.min);
}
