import { describe, expect, it } from "vitest";
import {
	collectExternalProjectAssets,
	isExternalProjectAssetPath,
} from "./project-copy-assets";

describe("project copy external assets", () => {
	it("detects absolute, drive and traversal paths", () => {
		expect(isExternalProjectAssetPath("/Users/me/secret.png")).toBe(true);
		expect(isExternalProjectAssetPath("C:\\Users\\me\\secret.png")).toBe(true);
		expect(isExternalProjectAssetPath("assets/../secret.png")).toBe(true);
		expect(
			isExternalProjectAssetPath("asset://localhost/Users/me/secret.png"),
		).toBe(true);
		expect(isExternalProjectAssetPath("assets/images/photo.png")).toBe(false);
		expect(isExternalProjectAssetPath("content/display.mp4")).toBe(false);
	});

	it("collects config external assets without duplicates", () => {
		const assets = collectExternalProjectAssets({
			background: { source: { path: "/Users/me/wallpaper.jpg" } },
			timeline: {
				imageSegments: [
					{ path: "/Users/me/secret.png" },
					{ path: "assets/images/a.png" },
					{ path: "/Users/me/secret.png" },
				],
				audioSegments: [{ path: "../outside.wav" }],
				styleSegments: [
					{
						overrides: {
							background: { source: { path: "/Users/me/style.jpg" } },
						},
					},
				],
			},
		});
		expect(assets).toEqual([
			"/Users/me/wallpaper.jpg",
			"/Users/me/secret.png",
			"../outside.wav",
			"/Users/me/style.jpg",
		]);
	});

	it("ignores internal-only projects", () => {
		expect(
			collectExternalProjectAssets({
				timeline: { imageSegments: [{ path: "assets/images/a.png" }] },
			}),
		).toEqual([]);
	});
});
