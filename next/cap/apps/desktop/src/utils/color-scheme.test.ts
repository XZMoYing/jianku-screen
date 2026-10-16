import {
	argbFromHex,
	Contrast,
	lstarFromArgb,
} from "@material/material-color-utilities";
import { describe, expect, it } from "vitest";
import {
	colorSchemeDefaults,
	colorTokens,
	colorVariants,
	normalizeColorSettings,
	selectedSeed,
	wallpaperSeeds,
} from "./color-scheme";

describe("dynamic UI colors", () => {
	it("defaults to wallpaper and safely falls back without Google Blue", () => {
		const settings = normalizeColorSettings();
		expect(settings.source).toBe("wallpaper");
		expect(selectedSeed(settings)).toBe(colorSchemeDefaults.seed);
		expect(wallpaperSeeds(new Uint8ClampedArray())).toEqual([
			colorSchemeDefaults.seed,
		]);
	});
	it("extracts distinct wallpaper colors and ignores transparent pixels", () => {
		const bytes = new Uint8ClampedArray(160 * 4);
		for (let index = 0; index < 160; index++) {
			bytes.set(
				index < 80 ? [50, 128, 65, 255] : [215, 128, 48, 255],
				index * 4,
			);
		}
		const seeds = wallpaperSeeds(bytes);
		expect(seeds.length).toBe(2);
		expect(seeds).toContain("#328041");
		expect(seeds).toContain("#d78030");
		expect(wallpaperSeeds(new Uint8ClampedArray([0, 0, 255, 0]))).toEqual([
			colorSchemeDefaults.seed,
		]);
	});
	it("retains a custom choice when wallpaper suggestions refresh", () => {
		const custom = normalizeColorSettings({
			source: "custom",
			seed: "#b66e4c",
			wallpaperSeeds: ["#337469"],
		});
		expect(selectedSeed(custom)).toBe("#b66e4c");
		const wallpaper = normalizeColorSettings({
			...custom,
			source: "wallpaper",
			wallpaperIndex: 9,
		});
		expect(selectedSeed(wallpaper)).toBe("#337469");
	});
	it("normalizes damaged persisted values", () => {
		const settings = normalizeColorSettings({
			seed: "invalid",
			contrast: Number.NaN,
			wallpaperSeeds: ["bad", "#337469"],
		});
		expect(settings.seed).toBe(colorSchemeDefaults.seed);
		expect(settings.contrast).toBe(0);
		expect(settings.wallpaperSeeds).toEqual(["#337469"]);
	});
	it("keeps primary and surface text readable for every scheme in both modes", () => {
		for (const seed of ["#337469", "#b66e4c", "#aa7900", "#646765"]) {
			for (const variant of colorVariants) {
				for (const dark of [false, true]) {
					const colors = colorTokens(seed, variant.id, dark);
					for (const [foreground, background] of [
						["ink", "surface"],
						["on-primary", "primary"],
					]) {
						const contrast = Contrast.ratioOfTones(
							lstarFromArgb(argbFromHex(colors[`--jk-${foreground}`])),
							lstarFromArgb(argbFromHex(colors[`--jk-${background}`])),
						);
						expect(
							contrast,
							`${seed}/${variant.id}/${dark}/${foreground}`,
						).toBeGreaterThanOrEqual(4.5);
					}
				}
			}
		}
	});
});
