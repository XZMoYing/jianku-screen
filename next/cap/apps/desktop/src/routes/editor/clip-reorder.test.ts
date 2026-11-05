import { expect, it } from "vitest";
import { reorderClipInstance } from "./clip-reorder";
import type { ClipTransition } from "./clip-transitions";

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
