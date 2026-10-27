import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sampleTrack } from "~/routes/editor/three-d";
import { camera3DSpringProgress } from "./camera3d-spring";

describe("3D spring parity", () => {
	it("matches the independently generated native samples across speeds and sliced ranges", () => {
		const samples = JSON.parse(
			readFileSync(
				new URL(
					"../../../../crates/rendering/test-data/camera3d-spring-progress.json",
					import.meta.url,
				),
				"utf8",
			),
		) as number[][];
		expect(samples).toHaveLength(2424);
		for (const [span, start, end, time, value] of samples)
			expect(
				sampleTrack(
					0,
					[
						{
							time: 0,
							value: 0,
							outEasing: null,
							inEasing: null,
							outSpring: { range: [start, end] },
						},
						{ time: span, value: 1, outEasing: null, inEasing: null },
					],
					time * span,
				),
			).toBeCloseTo(value, 11);
	});

	it("falls back safely for invalid phase ranges", () => {
		for (const range of [
			[0, 0],
			[-1, 1],
			[0, 2],
			[Number.NaN, 1],
		])
			expect(
				camera3DSpringProgress({ range: range as [number, number] }, 0.37),
			).toBe(0.37);
	});
});
