import { describe, expect, it } from "vitest";
import { InterfaceSpring, sampleSpring } from "./interface-spring";

describe("interface motion continuity", () => {
	it("preserves position and velocity when a held press is released", () => {
		const motion = new InterfaceSpring(1);
		motion.retarget(0.96, 0, 0.26, 0.86);
		const before = motion.read(45);
		motion.retarget(1, 45, 0.3, 1);
		expect(motion.read(45)).toEqual(before);
		expect(motion.read(900).value).toBeCloseTo(1, 5);
	});
	it("holds down until the release target changes", () => {
		const motion = new InterfaceSpring(1);
		motion.retarget(0.96, 0, 0.26, 0.86);
		expect(motion.read(2000).value).toBeCloseTo(0.96, 8);
		expect(motion.target).toBe(0.96);
	});
	it("keeps rapid indicator reversals continuous", () => {
		const motion = new InterfaceSpring(4);
		for (const [time, target] of [
			[0, 120],
			[60, 4],
			[85, 120],
			[110, 4],
		]) {
			const before = motion.read(time);
			motion.retarget(target, time);
			expect(motion.read(time)).toEqual(before);
		}
		expect(motion.read(1400).value).toBeCloseTo(4, 5);
	});
	it("uses a monotonic critically damped selection spring", () => {
		let previous = 0;
		for (let time = 0; time <= 1000; time++) {
			const state = sampleSpring({ value: 0, velocity: 0 }, 1, time / 1000);
			expect(state.value).toBeGreaterThanOrEqual(previous);
			expect(state.value).toBeLessThanOrEqual(1);
			previous = state.value;
		}
		expect(previous).toBeCloseTo(1, 5);
	});
});
