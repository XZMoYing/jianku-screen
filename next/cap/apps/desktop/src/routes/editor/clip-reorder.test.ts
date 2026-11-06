import { expect, it } from "vitest";
import { reorderClipInstance } from "./clip-reorder";
import type { ClipTransition } from "./clip-transitions";
import {
	attachOverlayToClip,
	editClipsWithOverlayAttachments,
	keepOverlayAtTimelineTime,
	overlayAttachmentLayout,
} from "./overlay-attachment";

function timeline() {
	return {
		segments: ["a", "b", "c"].map((id) => ({
			id,
			start: 0,
			end: 4,
			timescale: 1,
			recordingSegment: 0,
			name: id,
		})),
		transitions: [] as ClipTransition[],
		styleSegments: [],
		imageSegments: [],
		zoomSegments: [],
		sceneSegments: [],
		maskSegments: [],
		textSegments: [],
		captionSegments: [],
		audioSegments: [],
		camera3dSegments: [],
		keyboardSegments: [],
	};
}

it("moves the intended instance of repeated footage and retains its identity and properties", () => {
	const project = timeline();
	const instance = project.segments[1];
	expect(reorderClipInstance(project, "b", 3)).toEqual({ from: 1, to: 2 });
	expect(project.segments.map((segment) => segment.id)).toEqual([
		"a",
		"c",
		"b",
	]);
	expect(project.segments[2]).toBe(instance);
	expect(instance.name).toBe("b");
});

it("resolves a captured identity after another reorder and ignores a removed instance", () => {
	const project = timeline();
	reorderClipInstance(project, "b", 0);
	reorderClipInstance(project, "a", 3);
	expect(project.segments.map((segment) => segment.id)).toEqual([
		"b",
		"c",
		"a",
	]);
	const before = JSON.stringify(project);
	expect(reorderClipInstance(project, "removed", 0)).toBeNull();
	expect(JSON.stringify(project)).toBe(before);
});

it("keeps transitions only between their original adjacent pair", () => {
	const project = timeline();
	project.transitions = [
		{ segmentIndex: 1, type: "cross-fade", duration: 0.5 },
		{ segmentIndex: 2, type: "fade-through-black", duration: 0.25 },
	];
	reorderClipInstance(project, "c", 0);
	expect(project.transitions).toEqual([
		{ segmentIndex: 2, type: "cross-fade", duration: 0.5 },
	]);
});

it("reorders linked overlays while keeping an explicit timeline position through a dropped transition", () => {
	const base = timeline();
	base.transitions = [{ segmentIndex: 1, type: "cross-fade", duration: 0.5 }];
	const image = (name: string, start: number) => ({
		start,
		end: start + 0.5,
		track: 0,
		enabled: true,
		path: "image.png",
		name,
		center: { x: 0.5, y: 0.5 },
		size: { x: 0.25, y: 0.25 },
		opacity: 1,
		rotation: 0,
		rounding: 0,
		flipX: false,
		flipY: false,
		lockAspect: true,
	});
	const linked = image("linked", 5);
	const fixed = image("fixed", 5.5);
	const project = {
		...base,
		imageSegments: [
			{
				...linked,
				attachment: attachOverlayToClip(
					linked,
					overlayAttachmentLayout(base),
					"b",
				),
			},
			{ ...fixed, attachment: keepOverlayAtTimelineTime(fixed) },
			image("legacy", 6),
		],
	};
	expect(
		editClipsWithOverlayAttachments(
			project,
			() => reorderClipInstance(project, "b", 3) !== null,
		),
	).toBe(true);
	expect(
		project.imageSegments.map(({ name, start, end }) => [name, start, end]),
	).toEqual([
		["fixed", 5.5, 6],
		["legacy", 6.5, 7],
		["linked", 9.5, 10],
	]);
});
