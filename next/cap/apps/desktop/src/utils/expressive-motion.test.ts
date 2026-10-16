import { describe, expect, it } from "vitest";
import { springProgress } from "./expressive-motion";

describe("interface spring", () => {
	it("settles without a discontinuous endpoint or excessive bounce", () => {
		expect(springProgress(0)).toBeCloseTo(0);
		expect(springProgress(0.55)).toBeCloseTo(1, 3);
		const samples = Array.from({ length: 551 }, (_, i) =>
			springProgress(i / 1000),
		);
		expect(Math.max(...samples)).toBeLessThan(1.02);
		for (let i = 1; i < samples.length; i++)
			expect(Math.abs(samples[i] - samples[i - 1])).toBeLessThan(0.02);
	});
});
