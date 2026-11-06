import { describe, expect, it } from "vitest";
import { movePositionedMainTrackClip } from "./main-track-edit";
import {
	attachOverlayToClip,
	keepOverlayAtTimelineTime,
	moveClipsWithOverlayAttachments,
	overlayAttachmentLayout,
	overlayAttachmentStatus,
	projectOverlayAttachment,
} from "./overlay-attachment";
import { defaultCamera3DSegment, normalizeCamera3DSegments } from "./three-d";

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
			moveClipsWithOverlayAttachments(timeline, () =>
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
