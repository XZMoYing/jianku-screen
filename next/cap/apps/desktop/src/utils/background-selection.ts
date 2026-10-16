import type { BackgroundSource } from "./tauri";

export const BACKGROUND_CATEGORIES = [
	{ id: "desktop", name: "桌面" },
	{ id: "wallpaper", name: "壁纸" },
	{ id: "pattern", name: "网格" },
	{ id: "image", name: "图片" },
	{ id: "color", name: "颜色" },
	{ id: "gradient", name: "渐变" },
	{ id: "animatedGradient", name: "动态" },
] as const;
export type BackgroundCategory = (typeof BACKGROUND_CATEGORIES)[number]["id"];
export function backgroundCategory(
	source: BackgroundSource,
	desktop?: boolean,
): BackgroundCategory {
	if (source.type === "wallpaper") {
		if (source.path?.includes("pattern-")) return "pattern";
		if (
			desktop ||
			/\/com\.apple\.(?:wallpaper|idleassetsd)\//.test(source.path ?? "") ||
			/(?:current-desktop-background|capture-wallpaper)/.test(source.path ?? "")
		)
			return "desktop";
	}
	return source.type;
}
