import type {
	ClipAttachmentTiming,
	MainTrackGaps,
	OverlayAttachment,
	TimelineSegment,
} from "~/utils/tauri";
import { type ClipTransition, clipTimelineOffsets } from "./clip-transitions";
import {
	effectiveToOutput,
	type HoldSourceSegment,
	heldTimeBefore,
	holdWindows,
} from "./timeline-holds";
import { sortTrackSegments } from "./timelineTracks";

type AttachmentTimeline = {
	segments: TimelineSegment[];
	transitions: ClipTransition[];
	mainTrackGaps?: MainTrackGaps;
	textSegments?: readonly HoldSourceSegment[];
};

export type AttachmentSpan = {
	start: number;
	end: number;
	attachment?: OverlayAttachment | null;
};

export function overlayAttachmentLayout(timeline: AttachmentTimeline) {
	const offsets = clipTimelineOffsets(
		timeline.segments,
		timeline.transitions,
		timeline.mainTrackGaps,
	);
	const clips = new Map<
		string,
		{ start: number; sourceStart: number; sourceEnd: number; timescale: number }
	>();
	for (const [index, clip] of timeline.segments.entries()) {
		if (clip.id)
			clips.set(clip.id, {
				start: offsets[index],
				sourceStart: clip.start,
				sourceEnd: clip.end,
				timescale: clip.timescale,
			});
	}
	return { clips, holds: holdWindows(timeline.textSegments) };
}

type AttachmentLayout = ReturnType<typeof overlayAttachmentLayout>;
type ClipAttachment = Extract<OverlayAttachment, { kind: "clip" }>;

const attachmentTracks = [
	"zoomSegments",
	"sceneSegments",
	"maskSegments",
	"textSegments",
	"audioSegments",
	"styleSegments",
	"imageSegments",
	"camera3dSegments",
] as const;

type AttachedTimeline = Omit<AttachmentTimeline, "textSegments"> &
	Partial<
		Record<
			Exclude<(typeof attachmentTracks)[number], "textSegments">,
			AttachmentSpan[]
		>
	> & {
		textSegments?: (HoldSourceSegment & AttachmentSpan)[];
	};

function sourceTimeOnTimeline(
	attachment: ClipAttachment,
	layout: AttachmentLayout,
) {
	const placement = layout.clips.get(attachment.clipId);
	if (!placement || placement.timescale <= 0) return null;
	return (
		placement.start +
		(attachment.sourceTime - placement.sourceStart) / placement.timescale
	);
}

const attachmentId = (span: AttachmentSpan) =>
	span.attachment?.id ?? `overlay-${crypto.randomUUID()}`;

export function keepOverlayAtTimelineTime(
	span: AttachmentSpan,
): OverlayAttachment {
	return { kind: "timeline", id: attachmentId(span) };
}

export function attachOverlayToClip(
	span: AttachmentSpan,
	layout: AttachmentLayout,
	clipId: string,
	timing: ClipAttachmentTiming = "preserveDuration",
): ClipAttachment | null {
	const placement = layout.clips.get(clipId);
	if (!placement) return null;
	const effective = span.start - heldTimeBefore(layout.holds, span.start);
	const sourceTime =
		placement.sourceStart + (effective - placement.start) * placement.timescale;
	if (!Number.isFinite(sourceTime) || placement.timescale <= 0) return null;
	return { kind: "clip", id: attachmentId(span), clipId, sourceTime, timing };
}

export function overlayAttachmentStatus(
	attachment: OverlayAttachment | null | undefined,
	layout: AttachmentLayout,
) {
	if (!attachment) return "unassigned";
	if (attachment.kind === "timeline") return "timeline";
	const placement = layout.clips.get(attachment.clipId);
	if (!placement) return "missing-clip";
	return attachment.sourceTime >= placement.sourceStart &&
		attachment.sourceTime < placement.sourceEnd
		? "attached"
		: "outside-clip";
}

export function projectOverlayAttachment(
	span: AttachmentSpan,
	before: AttachmentLayout,
	after: AttachmentLayout,
) {
	const attachment = span.attachment;
	if (
		attachment?.kind !== "clip" ||
		overlayAttachmentStatus(attachment, after) !== "attached"
	)
		return null;
	const previous = before.clips.get(attachment.clipId);
	const next = after.clips.get(attachment.clipId);
	if (!previous || !next || previous.timescale <= 0 || next.timescale <= 0)
		return null;
	const afterAnchor = effectiveToOutput(
		after.holds,
		next.start + (attachment.sourceTime - next.sourceStart) / next.timescale,
	);
	const wasAttached =
		overlayAttachmentStatus(attachment, before) === "attached";
	const beforeAnchor = effectiveToOutput(
		before.holds,
		previous.start +
			(attachment.sourceTime - previous.sourceStart) / previous.timescale,
	);
	const ratio =
		wasAttached && attachment.timing === "followClipSpeed"
			? previous.timescale / next.timescale
			: 1;
	const start = wasAttached
		? span.start + (afterAnchor - beforeAnchor)
		: afterAnchor;
	const end = start + (span.end - span.start) * ratio;
	return Number.isFinite(start) &&
		Number.isFinite(end) &&
		start >= 0 &&
		end > start
		? { start, end, ratio }
		: null;
}

export function moveClipsWithOverlayAttachments(
	timeline: AttachedTimeline,
	edit: () => boolean,
) {
	const hasLinkedOverlay = attachmentTracks.some((track) =>
		timeline[track]?.some(({ attachment }) => attachment?.kind === "clip"),
	);
	const before = hasLinkedOverlay ? overlayAttachmentLayout(timeline) : null;
	if (!edit()) return false;
	if (!before) return true;

	const afterClips = overlayAttachmentLayout(timeline);
	const titles = (timeline.textSegments ?? []).flatMap((text) => {
		const attachment = text.attachment;
		if (
			text.enabled === false ||
			text.layout !== "fullscreen" ||
			attachment?.kind !== "clip" ||
			overlayAttachmentStatus(attachment, afterClips) !== "attached"
		)
			return [];
		const time = sourceTimeOnTimeline(attachment, afterClips);
		if (time === null || !Number.isFinite(time)) return [];
		return [{ text, time, previous: sourceTimeOnTimeline(attachment, before) }];
	});
	const scheduled = new Set(titles.map(({ text }) => text));
	let movedTitles = false;
	if (titles.some(({ time, previous }) => time !== previous)) {
		const holds = (timeline.textSegments ?? []).filter(
			(text) => !scheduled.has(text),
		);
		for (const { text, time } of titles.sort(
			(a, b) => a.time - b.time || a.text.start - b.text.start,
		)) {
			const start = effectiveToOutput(holdWindows(holds), time);
			const duration = text.end - text.start;
			movedTitles ||= text.start !== start;
			text.start = start;
			text.end = start + duration;
			holds.push(text);
		}
	}

	const after = movedTitles ? overlayAttachmentLayout(timeline) : afterClips;
	for (const track of attachmentTracks) {
		const rows = timeline[track];
		if (!rows) continue;
		let changed = track === "textSegments" && movedTitles;
		for (const row of rows) {
			if (scheduled.has(row)) continue;
			const projected = projectOverlayAttachment(row, before, after);
			if (
				!projected ||
				(row.start === projected.start && row.end === projected.end)
			)
				continue;
			row.start = projected.start;
			row.end = projected.end;
			changed = true;
		}
		if (changed) sortTrackSegments(rows);
	}
	return true;
}
