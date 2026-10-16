import { describe, expect, it } from "vitest";
import { InterfaceSpring, sampleSpring } from "./interface-spring";

describe("interface selection motion", () => {
	it("settles without overshoot for navigation indicators", () => {
		let previous = 0;
		for (let time = 0; time <= 1; time += 1 / 240) {
			const current = sampleSpring({ value: 0, velocity: 0 }, 100, time);
			expect(current.value).toBeGreaterThanOrEqual(previous);
			expect(current.value).toBeLessThanOrEqual(100);
			previous = current.value;
		}
		expect(previous).toBeCloseTo(100, 2);
	});
	it("keeps position and velocity continuous when another tab interrupts", () => {
		const spring = new InterfaceSpring(0);
		spring.retarget(200, 1000);
		const before = spring.read(1110);
		spring.retarget(40, 1110);
		expect(spring.read(1110)).toEqual(before);
		expect(spring.read(1111).value).toBeGreaterThan(before.value);
		expect(spring.read(2400).value).toBeCloseTo(40, 3);
	});
	it("preserves the section arrival spring rather than using the indicator spring", () => {
		const section = sampleSpring({ value: 0, velocity: 0 }, 1, 0.5, 0.62, 0.82);
		const indicator = sampleSpring({ value: 0, velocity: 0 }, 1, 0.5, 0.38, 1);
		expect(section.value).toBeGreaterThan(1);
		expect(indicator.value).toBeLessThan(1);
	});
});
