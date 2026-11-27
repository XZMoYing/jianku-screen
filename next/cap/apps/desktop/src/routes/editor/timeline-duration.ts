import type { TimelineConfiguration } from "~/utils/tauri";
import { type ClipTransition, clipTimelineDuration } from "./clip-transitions";
import {
	effectiveToOutputEnd,
	holdWindows,
	validContentRange,
} from "./timeline-holds";

type Timeline = Pick<TimelineConfiguration, "segments" | "mainTrackGaps"> &
	Partial<
		Pick<
			TimelineConfiguration,
			"textSegments" | "imageSegments" | "shapeSegments" | "audioSegments"
		>
	> & { transitions: ClipTransition[] };

export function timelineOutputDuration(timeline: Timeline) {
	const end = effectiveToOutputEnd(
		holdWindows(timeline.textSegments),
		clipTimelineDuration(
			timeline.segments,
			timeline.transitions,
			timeline.mainTrackGaps,
		),
	);
	let duration = end;
	for (const row of [
		...(timeline.textSegments ?? []),
		...(timeline.imageSegments ?? []).filter(
			(row) => !!row.path && row.opacity > 0,
		),
		...(timeline.shapeSegments ?? []).filter((row) => row.opacity > 0),
		...(timeline.audioSegments ?? []).filter(
			(row) => !!row.path && (row.volumeDb ?? 0) > -60,
		),
	]) {
		if (
			row.enabled !== false &&
			!("attachment" in row && row.attachment?.kind === "clip") &&
			validContentRange(row.start, row.end)
		)
			duration = Math.max(duration, row.end);
	}
	return duration;
}

export function timelinePreviewFrame(
	time: number,
	duration: number,
	fps: number,
) {
	const frame = time * fps;
	return Math.max(
		0,
		Math.min(
			Math.floor(frame + Number.EPSILON * Math.abs(frame)),
			Math.ceil(duration * fps) - 1,
		),
	);
}

export function atLastTimelineFrame(
	time: number,
	duration: number,
	fps: number,
) {
	return (
		duration > 0 &&
		timelinePreviewFrame(time, duration, fps) ===
			timelinePreviewFrame(duration, duration, fps)
	);
}
