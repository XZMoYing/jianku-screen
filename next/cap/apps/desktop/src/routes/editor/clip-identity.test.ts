import { describe, expect, it } from "vitest";
import {
	clipIndicesForIds,
	newClipInstance,
	normalizeClipIdentities,
} from "./clip-identity";
import { mergedClipSegment } from "./clip-merge";
import { cutClipSegmentsForRange } from "./timeline-utils";

describe("clip instance identity", () => {
	it("finds the same selected identities in a restored order and drops removed ones", () => {
		expect(
			clipIndicesForIds(
				[
					{ id: "b", start: 0 },
					{ id: "a", start: 4 },
				],
				["a", "removed", "b"],
			),
		).toEqual([1, 0]);
	});
	it("keeps legacy identity stable on an unchanged project, including repeated footage", () => {
		const legacy = [
			{ start: 0, end: 4, recordingSegment: 0 },
			{ start: 0, end: 4, recordingSegment: 0 },
		];
		const first = normalizeClipIdentities(legacy);
		expect(first[0].id).not.toBe(first[1].id);
		expect(normalizeClipIdentities(legacy)).toEqual(first);
		expect(normalizeClipIdentities(JSON.parse(JSON.stringify(first)))).toEqual(
			first,
		);
	});

	it("repairs duplicate identities without stealing an existing later identity", () => {
		const original = [
			{ id: "", start: 0 },
			{ id: "legacy-clip-0", start: 1 },
			{ id: "same", start: 2 },
			{ id: "same", start: 3 },
		];
		const normalized = normalizeClipIdentities(original);
		expect(normalized[1].id).toBe("legacy-clip-0");
		expect(normalized[2].id).toBe("same");
		expect(new Set(normalized.map((segment) => segment.id)).size).toBe(4);
		expect(original[0].id).toBe("");
	});

	it("gives a copied or split-off instance a new identity while preserving its settings", () => {
		const original = { id: "source", start: 2, end: 8, volume: 0.5 };
		const right = newClipInstance({ ...original, start: 5 });
		expect(right.id).not.toBe(original.id);
		expect(right).toMatchObject({ start: 5, end: 8, volume: 0.5 });
		expect(newClipInstance(original).id).not.toBe(right.id);
		expect(original.id).toBe("source");
	});

	it("retains an edited instance identity when clips are reordered or trimmed", () => {
		const [first, second] = normalizeClipIdentities([
			{ id: "a", start: 0, end: 4 },
			{ id: "b", start: 0, end: 4 },
		]);
		const edited = normalizeClipIdentities([{ ...second, start: 1 }, first]);
		expect(edited.map((segment) => segment.id)).toEqual(["b", "a"]);
	});

	it("keeps the left merge identity even when settings come from the right clip", () => {
		const left = {
			id: "left",
			start: 0,
			end: 2,
			timescale: 1,
			recordingSegment: 0,
			name: null,
		};
		const right = { ...left, id: "right", start: 2, end: 4, volume: 0.5 };
		const merged = mergedClipSegment(left, right, right);
		expect(merged).toMatchObject({ id: "left", start: 0, end: 4, volume: 0.5 });
	});

	it("preserves the retained instance and identifies the new right part after a middle cut", () => {
		const segments = [{ id: "original", start: 0, end: 10, timescale: 1 }];
		cutClipSegmentsForRange(segments, [], 3, 5);
		expect(segments.map((segment) => [segment.start, segment.end])).toEqual([
			[0, 3],
			[5, 10],
		]);
		expect(segments[0].id).toBe("original");
		expect(segments[1].id).not.toBe("original");
	});
});
