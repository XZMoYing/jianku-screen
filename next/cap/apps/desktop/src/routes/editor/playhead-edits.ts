import { MIN_AUDIO_SEGMENT_DURATION } from "./audio";

export const editableOverlayTracks = [
	"style",
	"image",
	"shape",
	"audio",
	"caption",
	"keyboard",
	"mask",
	"scene",
	"text",
	"zoom",
	"3d",
] as const;
export type EditableOverlayTrack = (typeof editableOverlayTracks)[number];

export function overlayEditMinimum(type: EditableOverlayTrack) {
	if (type === "audio") return MIN_AUDIO_SEGMENT_DURATION;
	if (type === "caption") return 0.5;
	if (type === "keyboard") return 0.3;
	if (type === "style" || type === "image" || type === "shape") return 0.05;
	return 1;
}

export type PlayheadSpan = {
	start: number;
	end: number;
	sourceSlices?: readonly unknown[] | null;
};

export function overlaySplitTargets<T extends PlayheadSpan>(
	type: EditableOverlayTrack,
	rows: readonly T[],
	at: number,
	indices?: readonly number[],
) {
	if (!Number.isFinite(at)) return [];
	const minimum = overlayEditMinimum(type);
	const selected = indices
		? [...new Set(indices)]
		: rows.map((_, index) => index);
	return selected.flatMap((index) => {
		const row = rows[index];
		if (
			!row ||
			(type === "zoom" && row.sourceSlices?.length) ||
			at - row.start < minimum ||
			row.end - at < minimum
		)
			return [];
		return [row];
	});
}

export function overlayTrimRange(
	type: EditableOverlayTrack,
	span: PlayheadSpan,
	edge: "start" | "end",
	at: number,
) {
	if (
		!Number.isFinite(at) ||
		at <= span.start ||
		at >= span.end ||
		(type === "zoom" && span.sourceSlices?.length)
	)
		return null;
	const range = { start: span.start, end: span.end, [edge]: at };
	return range.end - range.start >= overlayEditMinimum(type) ? range : null;
}
