import { expect, it } from "vitest";
import { createClipTrim } from "./clip-trim";

it("snaps a sped-up clip through a hold in output time", () => {
	const trim = createClipTrim({
		clip: { start: 2, end: 10, timescale: 2 },
		edge: "end",
		effectiveStart: 4,
		holds: [[5, 7]],
		sourceDuration: 12,
		minSourceDuration: 2,
	});
	expect(trim.edit(-21, 0.025, [9.5])).toEqual({
		sourceTime: 9,
		outputTime: 9.5,
		guide: 9.5,
	});
	expect(trim.edit(-21, 0.025, [])).toMatchObject({
		outputTime: 9.475,
		guide: null,
	});
});

it("rejects a snap inside a hold and aligns to its reachable edge", () => {
	const trim = createClipTrim({
		clip: { start: 2, end: 10, timescale: 2 },
		edge: "start",
		effectiveStart: 4,
		holds: [[5, 7]],
		sourceDuration: 12,
		minSourceDuration: 2,
	});
	expect(trim.edit(80, 0.025, [6])).toEqual({
		sourceTime: 4,
		outputTime: 7,
		guide: null,
	});
	expect(trim.edit(118, 0.025, [7])).toEqual({
		sourceTime: 4,
		outputTime: 7,
		guide: 7,
	});
});

it("enforces adjoining source limits without treating repeated footage as adjoining", () => {
	const options = {
		clip: { start: 2, end: 8, timescale: 1 },
		edge: "end" as const,
		effectiveStart: 0,
		holds: [],
		sourceDuration: 12,
		minSourceDuration: 1,
	};
	const adjoining = createClipTrim({
		...options,
		next: { start: 8, end: 10, timescale: 1 },
	});
	const repeated = createClipTrim({
		...options,
		next: { start: 0, end: 8, timescale: 1 },
	});
	expect(adjoining.edit(18, 0.02, [6.4])).toEqual({
		sourceTime: 8,
		outputTime: 6,
		guide: null,
	});
	expect(repeated.edit(18, 0.02, [6.4])).toEqual({
		sourceTime: 8.4,
		outputTime: 6.4,
		guide: 6.4,
	});
});

it("keeps a short existing clip valid when the displayed trim minimum is larger", () => {
	const trim = createClipTrim({
		clip: { start: 2, end: 2.25, timescale: 1 },
		edge: "start",
		effectiveStart: 4,
		holds: [],
		sourceDuration: 12,
		minSourceDuration: 1,
	});
	expect(trim.edit(20, 0.01, [4.2])).toEqual({
		sourceTime: 2,
		outputTime: 4,
		guide: null,
	});
});
