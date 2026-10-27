import { describe, expect, it } from "vitest";
import type {
	EditorPreviewQuality,
	PreviewResolutionOption,
} from "~/utils/tauri";
import {
	previewQualityLabel,
	readPreviewQuality,
	selectPreviewResolution,
} from "./preview-resolution";

function option(
	quality: EditorPreviewQuality,
	x: number,
	y: number,
	available = true,
	limited = false,
): PreviewResolutionOption {
	return {
		quality,
		outputSize: { x, y },
		resolutionBase: { x, y },
		available,
		limited,
	};
}

describe("preview resolution preferences", () => {
	it("migrates all three legacy percentage settings", () => {
		expect(readPreviewQuality("quarter")).toBe("360p");
		expect(readPreviewQuality("half")).toBe("720p");
		expect(readPreviewQuality("full")).toBe("1080p");
	});

	it("retains concrete choices and defaults invalid stored data to 720p", () => {
		for (const value of [
			"144p",
			"360p",
			"480p",
			"540p",
			"720p",
			"1080p",
			"1440p",
			"2160p",
			"original",
		]) {
			expect(readPreviewQuality(value)).toBe(value);
		}
		for (const value of [undefined, null, 720, "100%", "unknown"]) {
			expect(readPreviewQuality(value)).toBe("720p");
		}
	});

	it("uses the source ceiling without overwriting the preferred quality", () => {
		const preference = readPreviewQuality("1440p");
		const original = option("original", 320, 240);
		expect(
			selectPreviewResolution(
				[
					option("144p", 192, 144),
					option("1440p", 1920, 1440, false),
					original,
				],
				preference,
			),
		).toBe(original);
		const supported = option("1440p", 2560, 1440);
		expect(
			selectPreviewResolution(
				[supported, option("original", 3840, 2160)],
				preference,
			),
		).toBe(supported);
	});

	it("returns native portrait dimensions and respects a limited original", () => {
		const portrait = option("720p", 720, 1280);
		expect(
			selectPreviewResolution(
				[portrait, option("original", 1080, 1920)],
				"720p",
			).outputSize,
		).toEqual({ x: 720, y: 1280 });
		const capped = option("original", 4096, 3072, true, true);
		expect(previewQualityLabel(capped)).toBe("最高可用");
		expect(previewQualityLabel(option("original", 320, 240))).toBe(
			"原始清晰度",
		);
	});

	it("makes the pixel meaning of 2K and 4K explicit", () => {
		expect(previewQualityLabel(option("1440p", 2560, 1440))).toBe(
			"2K（1440p）",
		);
		expect(previewQualityLabel(option("2160p", 3840, 2160))).toBe(
			"4K（2160p）",
		);
	});
});
