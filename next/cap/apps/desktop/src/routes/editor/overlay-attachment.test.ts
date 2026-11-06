import { describe, expect, it } from "vitest";
import {
	cutPositionedMainTrackRange,
	movePositionedMainTrackClip,
	setPositionedMainTrackSpeed,
} from "./main-track-edit";
import {
	attachOverlayToClip,
	editClipsWithOverlayAttachments,
	initialOverlayAttachment,
	keepOverlayAtTimelineTime,
	overlayAttachmentLayout,
	overlayAttachmentStatus,
	overlayPartAfterSplit,
	projectOverlayAttachment,
} from "./overlay-attachment";
import { defaultCamera3DSegment, normalizeCamera3DSegments } from "./three-d";
import { deleteClipAndRippleAllTracks } from "./timeline-utils";

const clip = (id: string) => ({
	id,
	start: 4,
	end: 7,
	timescale: 1,
	recordingSegment: 0,
});
const sameSourceTwice = () => ({
	segments: [clip("a"), clip("b")],
	transitions: [],
});

describe("overlay attachment", () => {
	it("fixes newly authored content to the timeline when the selected clip cannot provide an anchor", () => {
		const layout = overlayAttachmentLayout(sameSourceTwice());
		const span = { start: 4, end: 5 };
		expect(initialOverlayAttachment(span, layout, null).kind).toBe("timeline");
		expect(initialOverlayAttachment(span, layout, "a").kind).toBe("timeline");
		expect(initialOverlayAttachment(span, layout, "b")).toMatchObject({
			kind: "clip",
			clipId: "b",
			sourceTime: 5,
		});
	});
	it("gives a split overlay its own identity and anchors the right part to its new start", () => {
		const layout = overlayAttachmentLayout(sameSourceTwice());
		const span = { start: 3.25, end: 5 };
		const attachment = attachOverlayToClip(span, layout, "b");
		const right = overlayPartAfterSplit(
			{ ...span, start: 4, attachment },
			layout,
		);
		expect(right.attachment).toMatchObject({
			kind: "clip",
			clipId: "b",
			sourceTime: 5,
		});
		expect(right.attachment?.id).not.toBe(attachment?.id);
	});
	it("rebinds only to a retained part of the same instance, then keeps the attachment after a merge", () => {
		const clips = sameSourceTwice();
		const layout = overlayAttachmentLayout(clips);
		const span = { start: 5, end: 5.5 };
		const image = {
			...span,
			attachment: attachOverlayToClip(span, layout, "b"),
		};
		const timeline = { ...clips, imageSegments: [image] };
		expect(
			editClipsWithOverlayAttachments(timeline, (replacements) =>
				cutPositionedMainTrackRange(timeline, 1, 4.25, 4.75, replacements),
			),
		).toBe(true);
		const right = timeline.segments[2].id;
		expect(right).not.toBe("b");
		expect(image.attachment).toMatchObject({ clipId: right, sourceTime: 6 });
		expect(image.start).toBe(5);
		editClipsWithOverlayAttachments(timeline, (replacements) => {
			timeline.segments = [clip("a"), clip("b")];
			Object.assign(timeline, { mainTrackGaps: undefined });
			replacements.set(right, ["b"]);
			return true;
		});
		expect(image.attachment).toMatchObject({ clipId: "b", sourceTime: 6 });
		expect(image.start).toBe(5);
	});

	it("keeps fixed content and the missing source reference through ripple deletion", () => {
		const clips = sameSourceTwice();
		const layout = overlayAttachmentLayout(clips);
		const span = { start: 4, end: 5 };
		const linked = {
			...span,
			attachment: attachOverlayToClip(span, layout, "b"),
		};
		const fixed = { ...span, attachment: keepOverlayAtTimelineTime(span) };
		const timeline = {
			...clips,
			imageSegments: [linked, fixed, { start: 5, end: 5.5 }],
		};
		expect(
			editClipsWithOverlayAttachments(timeline, () =>
				deleteClipAndRippleAllTracks(timeline, 1),
			),
		).toBe(true);
		expect(timeline.imageSegments).toEqual([linked, fixed]);
		expect(linked.start).toBe(4);
		expect(fixed.start).toBe(4);
		expect(
			overlayAttachmentStatus(
				linked.attachment,
				overlayAttachmentLayout(timeline),
			),
		).toBe("missing-clip");
	});

	it("retimes 3D keys and their animation lengths together without stretching linked audio", () => {
		const clips = sameSourceTwice();
		const layout = overlayAttachmentLayout(clips);
		const shot = defaultCamera3DSegment(4, 6);
		shot.attachment = attachOverlayToClip(shot, layout, "b", "followClipSpeed");
		shot.transitionIn = 0.25;
		shot.tracks.tiltX = [
			{ time: 1.5, value: 20, inEasing: null, outEasing: null },
		];
		const audio = {
			start: 4,
			end: 6,
			attachment: attachOverlayToClip(
				{ start: 4, end: 6 },
				layout,
				"b",
				"followClipSpeed",
			),
		};
		const timeline = {
			...clips,
			camera3dSegments: [shot],
			audioSegments: [audio],
		};
		expect(
			editClipsWithOverlayAttachments(timeline, () =>
				setPositionedMainTrackSpeed(timeline, 1, 2),
			),
		).toBe(true);
		expect(shot).toMatchObject({ start: 3.5, end: 4.5, transitionIn: 0.125 });
		expect(shot.tracks.tiltX).toMatchObject([{ time: 0.75, value: 20 }]);
		expect(audio).toMatchObject({ start: 3.5, end: 5.5 });
	});

	it("retains an overlay at its current location when following would create a lane overlap", () => {
		const clips = sameSourceTwice();
		const span = { start: 4, end: 5 };
		const linked = {
			...span,
			attachment: attachOverlayToClip(
				span,
				overlayAttachmentLayout(clips),
				"b",
			),
		};
		const fixed = { start: 7, end: 8 };
		const timeline = { ...clips, imageSegments: [linked, fixed] };
		expect(
			editClipsWithOverlayAttachments(timeline, () =>
				movePositionedMainTrackClip(timeline, "b", 6),
			),
		).toBe(true);
		expect(linked.start).toBe(4);
		expect(fixed.start).toBe(7);
		expect(
			overlayAttachmentStatus(
				linked.attachment,
				overlayAttachmentLayout(timeline),
				linked.start,
			),
		).toBe("offset");
	});

	it("moves a linked title hold before projecting later overlays in the same clip move", () => {
		const clips = sameSourceTwice();
		const originalTitle = {
			start: 3.5,
			end: 4.5,
			layout: "fullscreen" as const,
		};
		const originalImage = { start: 5.25, end: 5.75 };
		const layout = overlayAttachmentLayout({
			...clips,
			textSegments: [originalTitle],
		});
		const title = {
			...originalTitle,
			attachment: attachOverlayToClip(originalTitle, layout, "b"),
		};
		const image = {
			...originalImage,
			attachment: attachOverlayToClip(originalImage, layout, "b"),
		};
		const fixed = {
			start: 2,
			end: 3,
			attachment: keepOverlayAtTimelineTime({ start: 2, end: 3 }),
		};
		const timeline = {
			...clips,
			textSegments: [title],
			imageSegments: [fixed, image],
		};
		expect(
			editClipsWithOverlayAttachments(timeline, () =>
				movePositionedMainTrackClip(timeline, "b", 6),
			),
		).toBe(true);
		expect(title).toMatchObject({ start: 6.5, end: 7.5 });
		expect(image).toMatchObject({ start: 8.25, end: 8.75 });
		expect(fixed).toMatchObject({ start: 2, end: 3 });
	});
	it("anchors to the chosen repeated instance through a gap, hold and reorder", () => {
		const timeline = {
			...sameSourceTwice(),
			mainTrackGaps: { beforeClip: { b: 0.75 } },
			textSegments: [{ layout: "fullscreen" as const, start: 4, end: 5 }],
		};
		const before = overlayAttachmentLayout(timeline);
		const span = { start: 5.25, end: 6.25 };
		const attachment = attachOverlayToClip(span, before, "b");
		expect(attachment).toMatchObject({
			kind: "clip",
			clipId: "b",
			sourceTime: 4.5,
			timing: "preserveDuration",
		});
		const after = overlayAttachmentLayout({
			...timeline,
			segments: timeline.segments.slice().reverse(),
			textSegments: [],
		});
		expect(
			projectOverlayAttachment({ ...span, attachment }, before, after),
		).toEqual({ start: 1.25, end: 2.25, ratio: 1 });
		expect(keepOverlayAtTimelineTime({ ...span, attachment }).id).toBe(
			attachment?.id,
		);
	});

	it("captures pre-edit speed and preserves duration unless the overlay follows it", () => {
		const timeline = sameSourceTwice();
		const before = overlayAttachmentLayout(timeline);
		const span = { start: 4, end: 6 };
		const attachment = attachOverlayToClip(
			span,
			before,
			"b",
			"followClipSpeed",
		);
		const fixedLength = attachOverlayToClip(span, before, "b");
		timeline.segments[1].timescale = 2;
		const after = overlayAttachmentLayout(timeline);
		expect(
			projectOverlayAttachment({ ...span, attachment }, before, after),
		).toEqual({ start: 3.5, end: 4.5, ratio: 0.5 });
		expect(
			projectOverlayAttachment(
				{ ...span, attachment: fixedLength },
				before,
				after,
			),
		).toEqual({ start: 3.5, end: 5.5, ratio: 1 });
	});

	it("distinguishes a missing clip, an invisible source anchor and a fixed overlay", () => {
		const timeline = sameSourceTwice();
		const before = overlayAttachmentLayout(timeline);
		const span = { start: 4, end: 5 };
		const attachment = attachOverlayToClip(span, before, "b");
		const removed = overlayAttachmentLayout({
			...timeline,
			segments: [clip("a")],
		});
		timeline.segments[1].start = 6;
		const trimmed = overlayAttachmentLayout(timeline);
		expect(overlayAttachmentStatus(undefined, before)).toBe("unassigned");
		expect(
			overlayAttachmentStatus(keepOverlayAtTimelineTime(span), before),
		).toBe("timeline");
		expect(overlayAttachmentStatus(attachment, removed)).toBe("missing-clip");
		expect(overlayAttachmentStatus(attachment, trimmed)).toBe("outside-clip");
		expect(
			projectOverlayAttachment({ ...span, attachment }, before, trimmed),
		).toBeNull();
		expect(
			projectOverlayAttachment({ ...span, attachment }, trimmed, before),
		).toEqual({ start: 4, end: 5, ratio: 1 });
	});

	it("preserves the attachment when normalizing existing 3D motion", () => {
		const shot = defaultCamera3DSegment(3, 5);
		const attachment = attachOverlayToClip(
			shot,
			overlayAttachmentLayout(sameSourceTwice()),
			"b",
		);
		const [loaded] = normalizeCamera3DSegments([{ ...shot, attachment }]);
		expect(loaded.attachment).toEqual(attachment);
		expect(loaded.tracks).toEqual(normalizeCamera3DSegments([shot])[0].tracks);
	});
});
