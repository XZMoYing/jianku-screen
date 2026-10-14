import { describe, expect, it } from "vitest";
import {
	mobileCaptureDefaults,
	parseMobileCaptureSettings,
} from "./mobile-capture-settings";

describe("mobile capture settings storage", () => {
	it("restores a saved portrait-friendly size, frame limit and orientation", () => {
		const saved = {
			maxSize: 1920,
			maxFps: 30,
			bitRateMbps: 8,
			orientation: "rotate90",
		};
		expect(parseMobileCaptureSettings(JSON.stringify(saved))).toEqual(saved);
	});
	it.each(["invalid", "null", "[]", "42"])(
		"recovers from unusable storage: %s",
		(raw) => {
			expect(parseMobileCaptureSettings(raw)).toEqual(mobileCaptureDefaults);
		},
	);
	it("keeps valid values when other saved fields are obsolete", () => {
		expect(
			parseMobileCaptureSettings(
				'{"maxSize":8192,"maxFps":30,"bitRateMbps":-1,"orientation":"free"}',
			),
		).toEqual({ ...mobileCaptureDefaults, maxFps: 30 });
	});
});
