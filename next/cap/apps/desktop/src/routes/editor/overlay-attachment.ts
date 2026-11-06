import type {
	ClipAttachmentTiming,
	MainTrackGaps,
	OverlayAttachment,
	TimelineSegment,
} from "~/utils/tauri";
import { type ClipTransition, clipTimelineOffsets } from "./clip-transitions";
import { type Camera3DTracks, scaleKeyframeTimes } from "./three-d";
import {
	effectiveToOutput,
	type HoldSourceSegment,
	heldTimeBefore,
	holdWindows,
} from "./timeline-holds";
import { getSegmentTrack, sortTrackSegments } from "./timelineTracks";

type AttachmentTimeline = {
	segments: TimelineSegment[];
	transitions: ClipTransition[];
	mainTrackGaps?: MainTrackGaps;
	textSegments?: readonly HoldSourceSegment[];
};

export type AttachmentSpan = {
	start: number;
	end: number;
	track?: number;
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
export type ClipReplacements = Map<string, string[]>;

const trackKeys = {
	zoom: "zoomSegments",
	scene: "sceneSegments",
	mask: "maskSegments",
	text: "textSegments",
	audio: "audioSegments",
	style: "styleSegments",
	image: "imageSegments",
	"3d": "camera3dSegments",
} as const;

export function overlayAttachmentTrack(type: string) {
	return Object.hasOwn(trackKeys, type)
		? trackKeys[type as keyof typeof trackKeys]
		: undefined;
}

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

export function overlayPartAfterSplit<T extends AttachmentSpan>(
	span: T,
	layout: AttachmentLayout | null,
): T {
	if (!span.attachment) return span;
	const attachment = {
		...span.attachment,
		id: `overlay-${crypto.randomUUID()}`,
	};
	const next = { ...span, attachment };
	if (attachment.kind === "clip" && layout)
		next.attachment =
			attachOverlayToClip(next, layout, attachment.clipId, attachment.timing) ??
			attachment;
	return next;
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
	outputTime?: number,
) {
	if (!attachment) return "unassigned";
	if (attachment.kind === "timeline") return "timeline";
	const placement = layout.clips.get(attachment.clipId);
	if (!placement) return "missing-clip";
	if (
		!Number.isFinite(attachment.sourceTime) ||
		attachment.sourceTime < placement.sourceStart ||
		attachment.sourceTime >= placement.sourceEnd
	)
		return "outside-clip";
	const expected = sourceTimeOnTimeline(attachment, layout);
	if (
		outputTime !== undefined &&
		expected !== null &&
		Math.abs(outputTime - heldTimeBefore(layout.holds, outputTime) - expected) >
			1e-6
	)
		return "offset";
	return "attached";
}

export function projectOverlayAttachment(
	span: AttachmentSpan,
	before: AttachmentLayout,
	after: AttachmentLayout,
	previousClipId?: string,
	preserveDuration = false,
) {
	const attachment = span.attachment;
	if (
		attachment?.kind !== "clip" ||
		overlayAttachmentStatus(attachment, after) !== "attached"
	)
		return null;
	const previousAttachment =
		previousClipId === undefined
			? attachment
			: { ...attachment, clipId: previousClipId };
	const previous = before.clips.get(previousAttachment.clipId);
	const next = after.clips.get(attachment.clipId);
	if (!previous || !next || previous.timescale <= 0 || next.timescale <= 0)
		return null;
	const afterAnchor = effectiveToOutput(
		after.holds,
		next.start + (attachment.sourceTime - next.sourceStart) / next.timescale,
	);
	const wasAttached =
		overlayAttachmentStatus(previousAttachment, before) === "attached";
	const beforeAnchor = effectiveToOutput(
		before.holds,
		previous.start +
			(attachment.sourceTime - previous.sourceStart) / previous.timescale,
	);
	const ratio =
		wasAttached && !preserveDuration && attachment.timing === "followClipSpeed"
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

export function captureOverlayAttachmentLayout(timeline: AttachedTimeline) {
	return attachmentTracks.some((track) =>
		timeline[track]?.some(({ attachment }) => attachment?.kind === "clip"),
	)
		? overlayAttachmentLayout(timeline)
		: null;
}

function resolveReplacement(
	attachment: ClipAttachment,
	after: AttachmentLayout,
	replacements: ClipReplacements,
) {
	const visited = new Set<string>();
	const candidates = [attachment.clipId];
	for (let index = 0; index < candidates.length; index++) {
		const clipId = candidates[index];
		if (visited.has(clipId)) continue;
		visited.add(clipId);
		const candidate =
			clipId === attachment.clipId ? attachment : { ...attachment, clipId };
		if (overlayAttachmentStatus(candidate, after) === "attached")
			return candidate;
		candidates.push(...(replacements.get(clipId) ?? []));
	}
	return attachment;
}

function scaleAttachedAnimation(row: AttachmentSpan, ratio: number) {
	if (ratio === 1) return;
	const timed = row as AttachmentSpan &
		Partial<
			Record<
				| "fadeDuration"
				| "animationInDuration"
				| "animationOutDuration"
				| "layoutTransition"
				| "transitionIn"
				| "transitionOut"
				| "joinDuration",
				number | null
			>
		> & {
			tracks?: Camera3DTracks;
			keyframes?: Record<string, { time: number }[]>;
		};
	for (const key of [
		"fadeDuration",
		"animationInDuration",
		"animationOutDuration",
		"layoutTransition",
		"transitionIn",
		"transitionOut",
		"joinDuration",
	] as const) {
		const duration = timed[key];
		if (typeof duration === "number") timed[key] = duration * ratio;
	}
	if (timed.tracks) scaleKeyframeTimes(timed.tracks, ratio);
	for (const keys of Object.values(timed.keyframes ?? {})) {
		for (const key of keys ?? []) key.time *= ratio;
	}
}

function overlaps(
	left: { start: number; end: number },
	right: { start: number; end: number },
) {
	return (
		Math.min(left.end, right.end) - Math.max(left.start, right.start) > 1e-7
	);
}

export function applyOverlayAttachmentEdit(
	timeline: AttachedTimeline,
	before: AttachmentLayout | null,
	replacements: ClipReplacements = new Map(),
) {
	if (!before) return;

	const afterClips = overlayAttachmentLayout(timeline);
	const previousClipIds = new Map<AttachmentSpan, string>();
	if (replacements.size) {
		for (const track of attachmentTracks) {
			for (const row of timeline[track] ?? []) {
				const attachment = row.attachment;
				if (attachment?.kind !== "clip") continue;
				const next = resolveReplacement(attachment, afterClips, replacements);
				if (next.clipId === attachment.clipId) continue;
				previousClipIds.set(row, attachment.clipId);
				row.attachment = next;
			}
		}
	}
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
		const clipId = previousClipIds.get(text) ?? attachment.clipId;
		return [
			{
				text,
				time,
				previous: sourceTimeOnTimeline({ ...attachment, clipId }, before),
			},
		];
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
			if (
				holds.some(
					(hold) =>
						hold.layout === "fullscreen" &&
						hold.enabled !== false &&
						!overlaps(text, hold) &&
						overlaps({ start, end: start + duration }, hold),
				)
			) {
				holds.push(text);
				continue;
			}
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
		const proposals = new Map<
			AttachmentSpan,
			{ start: number; end: number; ratio: number }
		>();
		for (const row of rows) {
			if (scheduled.has(row)) continue;
			const projected = projectOverlayAttachment(
				row,
				before,
				after,
				previousClipIds.get(row),
				track === "audioSegments",
			);
			if (
				!projected ||
				(row.start === projected.start && row.end === projected.end)
			)
				continue;
			proposals.set(row, projected);
		}
		let removed = true;
		while (removed) {
			removed = false;
			for (const [row, projected] of proposals) {
				if (
					rows.some(
						(other) =>
							other !== row &&
							getSegmentTrack(row) === getSegmentTrack(other) &&
							!overlaps(row, other) &&
							overlaps(projected, proposals.get(other) ?? other),
					)
				) {
					proposals.delete(row);
					removed = true;
				}
			}
		}
		for (const [row, projected] of proposals) {
			row.start = projected.start;
			row.end = projected.end;
			scaleAttachedAnimation(row, projected.ratio);
			changed = true;
		}
		if (changed) sortTrackSegments(rows);
	}
}

export function editClipsWithOverlayAttachments(
	timeline: AttachedTimeline,
	edit: (replacements: ClipReplacements) => boolean,
) {
	const before = captureOverlayAttachmentLayout(timeline);
	const replacements: ClipReplacements = new Map();
	if (!edit(replacements)) return false;
	applyOverlayAttachmentEdit(timeline, before, replacements);
	return true;
}
