import {
	clipTimelineOffsets,
	getClipTransition,
	rippleTimelineTrack,
	transitionsAfterClipMove,
} from "./clip-transitions";
import type { EditorProjectConfiguration } from "./context";
import { rippleKeyboardTrack } from "./keyboard-timing";
import {
	type AttachmentSpan,
	hasOverlayAttachment,
} from "./overlay-attachment";
import { scaleKeyframeTimes } from "./three-d";
import { effectiveToOutput, holdWindows } from "./timeline-holds";

export function reorderClipInstance(
	timeline: NonNullable<EditorProjectConfiguration["timeline"]>,
	clipId: string,
	insertionIndex: number,
) {
	const from = timeline.segments.findIndex((segment) => segment.id === clipId);
	if (
		from < 0 ||
		!Number.isInteger(insertionIndex) ||
		insertionIndex < 0 ||
		insertionIndex > timeline.segments.length
	)
		return null;
	const to = insertionIndex - (from < insertionIndex ? 1 : 0);
	if (from === to) return null;
	const proposedSegments = [...timeline.segments];
	const [moved] = proposedSegments.splice(from, 1);
	proposedSegments.splice(to, 0, moved);
	const { kept, dropped } = transitionsAfterClipMove(
		timeline.segments.length,
		timeline.transitions ?? [],
		from,
		to,
	);
	dropped.sort((a, b) => b.segmentIndex - a.segmentIndex);
	for (const transition of dropped) {
		const effective = getClipTransition(
			timeline.segments,
			timeline.transitions,
			transition.segmentIndex,
			timeline.mainTrackGaps,
		);
		if (!effective) continue;
		const boundary = effectiveToOutput(
			holdWindows(timeline.textSegments),
			clipTimelineOffsets(
				timeline.segments,
				timeline.transitions,
				timeline.mainTrackGaps,
			)[transition.segmentIndex] + effective.duration,
		);
		timeline.transitions = timeline.transitions.filter(
			(candidate) => candidate.segmentIndex !== transition.segmentIndex,
		);
		const camera3d = timeline.camera3dSegments ?? [];
		const previousDurations = camera3d.map(
			(segment) => segment.end - segment.start,
		);
		const rippleTracks: AttachmentSpan[][] = [
			timeline.styleSegments,
			timeline.imageSegments,
			timeline.zoomSegments,
			timeline.sceneSegments ?? [],
			timeline.maskSegments,
			timeline.textSegments,
			timeline.captionSegments ?? [],
			timeline.audioSegments ?? [],
			camera3d,
		];
		for (const track of rippleTracks)
			rippleTimelineTrack(
				track.filter((row) => !hasOverlayAttachment(row)),
				boundary,
				effective.duration,
			);
		rippleKeyboardTrack(
			timeline.keyboardSegments ?? [],
			boundary,
			effective.duration,
		);
		for (let index = 0; index < camera3d.length; index++) {
			const segment = camera3d[index];
			const previous = previousDurations[index];
			const duration = segment.end - segment.start;
			if (previous > 0 && previous !== duration)
				scaleKeyframeTimes(segment.tracks, duration / previous);
		}
	}
	timeline.segments = proposedSegments;
	timeline.transitions = kept;
	return { from, to };
}
