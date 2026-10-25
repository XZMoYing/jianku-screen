import { describe, expect, it } from "vitest";
import type { AspectRatio, BackgroundConfiguration } from "~/utils/tauri";
import fixtures from "./inset-layout-fixtures.json";
import { calculateImageTransform, remapImageAnnotations } from "./layout";

describe("screenshot decoration geometry", () => {
	it("matches native geometry across crop, aspect, frame styles, inset widths and position", () => {
		for (const fixture of fixtures) {
			const actual = calculateImageTransform(
				fixture.frameSize,
				fixture.imageSize,
				fixture.padding,
				fixture.crop,
				fixture.aspectRatio as AspectRatio | null,
				fixture.decoration as Pick<
					BackgroundConfiguration,
					"inset" | "frame" | "displayPosition"
				>,
			);
			for (const part of ["offset", "size"] as const) {
				const values = Object.entries(actual[part]);
				for (const [key, value] of values) {
					const expected: Record<string, number> = fixture.expected[part];
					expect(value, JSON.stringify(fixture)).toBeCloseTo(expected[key], 6);
				}
			}
		}
	});

	it("keeps old undecorated layouts unchanged and handles a collapsed canvas", () => {
		const args = [
			{ width: 1280, height: 720 },
			{ width: 1920, height: 1080 },
			20,
			null,
			null,
		] as const;
		expect(
			calculateImageTransform(...args, {
				inset: 0,
				frame: null,
				displayPosition: null,
			}),
		).toEqual(calculateImageTransform(...args));
		const empty = calculateImageTransform(
			{ width: 0, height: 0 },
			{ width: 1920, height: 1080 },
			0,
			null,
			null,
			{ inset: 100, frame: null, displayPosition: null },
		);
		expect(empty.size).toEqual({ width: 0, height: 0 });
	});

	it("keeps annotations on their source pixels when inset or frame geometry changes", () => {
		const previous = {
			offset: { x: 100, y: 50 },
			size: { width: 800, height: 450 },
		};
		const next = {
			offset: { x: 150, y: 90 },
			size: { width: 640, height: 360 },
		};
		const original = [
			{ id: "arrow", x: 500, y: 275, width: 80, height: 40, text: "保留" },
		];
		const mapped = remapImageAnnotations(original, previous, next);
		expect(mapped[0]).toEqual({
			id: "arrow",
			x: 470,
			y: 270,
			width: 64,
			height: 32,
			text: "保留",
		});
		expect(remapImageAnnotations(mapped, next, previous)).toEqual(original);
		expect(original[0].x).toBe(500);
	});
});
