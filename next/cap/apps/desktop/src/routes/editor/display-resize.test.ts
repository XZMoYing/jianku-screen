import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
	calculateDisplayLayout,
	calculateSceneOutputSize,
} from "~/routes/screenshot-editor/layout";
import type { AspectRatio, BackgroundConfiguration } from "~/utils/tauri";
import {
	type DisplayResizeInput,
	displayResizeLayout,
	resolveDisplayResize,
} from "./display-resize";

type NativeFixture = {
	frameSize: { width: number; height: number };
	imageSize: { width: number; height: number };
	padding: number;
	crop: BackgroundConfiguration["crop"];
	aspectRatio: AspectRatio | null;
	decoration: Pick<
		BackgroundConfiguration,
		"frame" | "inset" | "displayPosition"
	>;
	styledOuter: {
		offset: { x: number; y: number };
		size: { width: number; height: number };
	};
	outer: {
		offset: { x: number; y: number };
		size: { width: number; height: number };
	};
};
const fixtures: NativeFixture[] = [10, 20, 40, 70].flatMap((padding) =>
	JSON.parse(
		gunzipSync(
			readFileSync(
				new URL(
					`../../../../../../verification/2026-11-01-display-resize/native-layout-${padding}.json.gz`,
					import.meta.url,
				),
			),
		).toString(),
	),
);
const input = (fixture: NativeFixture): DisplayResizeInput => ({
	imageSize: fixture.imageSize,
	background: {
		...fixture.decoration,
		crop: fixture.crop,
		padding: fixture.padding,
	},
	aspectRatio: fixture.aspectRatio,
	resolutionBase: { x: 1280, y: 720 },
});

describe("native display resizing geometry", () => {
	it("matches native output rounding and outer cards across 756 source/crop/aspect/frame/inset layouts", () => {
		expect(fixtures).toHaveLength(756);
		for (const fixture of fixtures) {
			const args = input(fixture);
			expect(
				calculateSceneOutputSize(
					args.imageSize,
					args.background.padding,
					args.background.crop,
					args.aspectRatio,
					args.resolutionBase,
				),
			).toEqual(fixture.frameSize);
			const layout = calculateDisplayLayout(
				fixture.frameSize,
				args.imageSize,
				args.background.padding,
				args.background.crop,
				args.aspectRatio,
				args.background,
			).outer;
			for (const part of ["offset", "size"] as const)
				for (const [key, value] of Object.entries(layout[part]))
					expect(value, JSON.stringify(fixture)).toBeCloseTo(
						(fixture.outer[part] as Record<string, number>)[key],
						6,
					);
		}
	});

	it("matches native selected-style geometry on a fixed base canvas", () => {
		for (const fixture of fixtures) {
			const args = {
				...input(fixture),
				canvasSize: { width: 1280, height: 720 },
			};
			const rect = displayResizeLayout(args, fixture.padding);
			expect(rect.x * 1280).toBeCloseTo(fixture.styledOuter.offset.x, 6);
			expect(rect.y * 720).toBeCloseTo(fixture.styledOuter.offset.y, 6);
			expect(rect.w * 1280).toBeCloseTo(fixture.styledOuter.size.width, 6);
			expect(rect.h * 720).toBeCloseTo(fixture.styledOuter.size.height, 6);
		}
	});

	it("round-trips the current rendered width without changing padding", () => {
		for (const fixture of fixtures) {
			const args = input(fixture);
			const initial = displayResizeLayout(args, fixture.padding);
			const result = resolveDisplayResize(args, initial.w);
			expect(result.padding).toBe(fixture.padding);
			expect(result.rect).toEqual(initial);
		}
	});

	it("keeps reverse mapping and the displayed outline on the exact same geometry", () => {
		for (const fixture of fixtures.filter((_, index) => index % 3 === 0)) {
			const args = input(fixture);
			const target = displayResizeLayout(args, 37.413).w;
			const result = resolveDisplayResize(args, target);
			expect(
				Math.abs(result.rect.w - target) * fixture.frameSize.width,
			).toBeLessThan(1);
			expect(result.rect).toEqual(displayResizeLayout(args, result.padding));
			expect(result.padding).toBeGreaterThanOrEqual(0);
			expect(result.padding).toBeLessThanOrEqual(100);
		}
	});

	it("uses a fixed base canvas when changing a selected style", () => {
		const args = {
			...input(fixtures[3]),
			canvasSize: { width: 1280, height: 720 },
		};
		const target = displayResizeLayout(args, 35).w;
		const result = resolveDisplayResize(args, target);
		expect(result.rect.w).toBeCloseTo(target, 6);
		expect(result.rect.x + result.rect.w / 2).toBeCloseTo(0.55);
		expect(result.rect.y + result.rect.h / 2).toBeCloseTo(0.45);
	});
});
