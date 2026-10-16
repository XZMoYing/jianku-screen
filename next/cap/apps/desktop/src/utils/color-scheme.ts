import {
	argbFromHex,
	argbFromRgb,
	Hct,
	hexFromArgb,
	QuantizerCelebi,
	SchemeExpressive,
	SchemeMonochrome,
	SchemeNeutral,
	SchemeTonalSpot,
	SchemeVibrant,
	Score,
} from "@material/material-color-utilities";

export type ColorVariant =
	| "tonal"
	| "vibrant"
	| "expressive"
	| "neutral"
	| "mono";
export type ColorSchemeSettings = {
	source: "wallpaper" | "custom";
	seed: string;
	variant: ColorVariant;
	contrast: number;
	wallpaperIndex: number;
	wallpaperSeeds: string[];
	wallpaperUpdatedAt: number;
};
export const colorSchemeDefaults: ColorSchemeSettings = {
	source: "wallpaper",
	seed: "#6b7351",
	variant: "tonal",
	contrast: 0,
	wallpaperIndex: 0,
	wallpaperSeeds: [],
	wallpaperUpdatedAt: 0,
};
export const colorVariants: { id: ColorVariant; name: string }[] = [
	{ id: "tonal", name: "柔和" },
	{ id: "vibrant", name: "鲜明" },
	{ id: "expressive", name: "灵动" },
	{ id: "neutral", name: "淡雅" },
	{ id: "mono", name: "黑白" },
];
export const basicColors = [
	{ name: "橄榄", hex: "#6b7351" },
	{ name: "陶土", hex: "#b66e4c" },
	{ name: "琥珀", hex: "#aa7900" },
	{ name: "松针", hex: "#337469" },
	{ name: "玫瑰", hex: "#a34d64" },
	{ name: "青绿", hex: "#10767f" },
	{ name: "胡桃", hex: "#8a6453" },
	{ name: "石墨", hex: "#646765" },
];
const validHex = (value: unknown): value is string =>
	typeof value === "string" && /^#[\da-f]{6}$/i.test(value);
export function normalizeColorSettings(
	value?: Partial<ColorSchemeSettings> | null,
) {
	return {
		...colorSchemeDefaults,
		...value,
		source: value?.source === "custom" ? "custom" : "wallpaper",
		seed: validHex(value?.seed) ? value.seed : colorSchemeDefaults.seed,
		variant: colorVariants.some((item) => item.id === value?.variant)
			? (value?.variant ?? "tonal")
			: "tonal",
		contrast: Number.isFinite(value?.contrast)
			? Math.max(0, Math.min(1, value?.contrast ?? 0))
			: 0,
		wallpaperIndex: Math.max(0, Math.floor(value?.wallpaperIndex || 0)),
		wallpaperSeeds: Array.isArray(value?.wallpaperSeeds)
			? value.wallpaperSeeds.filter(validHex).slice(0, 4)
			: [],
		wallpaperUpdatedAt: Number.isFinite(value?.wallpaperUpdatedAt)
			? (value?.wallpaperUpdatedAt ?? 0)
			: 0,
	} satisfies ColorSchemeSettings;
}
export function selectedSeed(settings: ColorSchemeSettings) {
	return settings.source === "wallpaper"
		? (settings.wallpaperSeeds[settings.wallpaperIndex] ??
				settings.wallpaperSeeds[0] ??
				colorSchemeDefaults.seed)
		: settings.seed;
}
export function wallpaperSeeds(bytes: Uint8ClampedArray): string[] {
	const pixels: number[] = [];
	for (let index = 0; index + 3 < bytes.length; index += 4) {
		if (bytes[index + 3] < 255) continue;
		pixels.push(argbFromRgb(bytes[index], bytes[index + 1], bytes[index + 2]));
	}
	return Score.score(QuantizerCelebi.quantize(pixels, 64), {
		desired: 4,
		fallbackColorARGB: argbFromHex(colorSchemeDefaults.seed),
	}).map(hexFromArgb);
}
export function colorTokens(
	seed: string,
	variant: ColorVariant,
	dark: boolean,
	contrast = 0,
) {
	const Scheme = {
		tonal: SchemeTonalSpot,
		vibrant: SchemeVibrant,
		expressive: SchemeExpressive,
		neutral: SchemeNeutral,
		mono: SchemeMonochrome,
	}[variant];
	const scheme = new Scheme(
		Hct.fromInt(argbFromHex(seed)),
		dark,
		contrast,
		"2025",
	);
	const colors: Record<string, number> = {
		primary: scheme.primary,
		"on-primary": scheme.onPrimary,
		"primary-container": scheme.primaryContainer,
		"on-primary-container": scheme.onPrimaryContainer,
		"secondary-container": scheme.secondaryContainer,
		"tertiary-container": scheme.tertiaryContainer,
		secondary: scheme.secondary,
		tertiary: scheme.tertiary,
		surface: scheme.surface,
		"container-low": scheme.surfaceContainerLow,
		container: scheme.surfaceContainer,
		"container-high": scheme.surfaceContainerHigh,
		"container-highest": scheme.surfaceContainerHighest,
		paper: scheme.surfaceContainerLowest,
		ink: scheme.onSurface,
		muted: scheme.onSurfaceVariant,
		outline: scheme.outline,
		"outline-soft": scheme.outlineVariant,
		error: scheme.error,
		"on-error": scheme.onError,
		focus: scheme.primary,
	};
	return Object.fromEntries(
		Object.entries(colors).map(([key, value]) => [
			`--jk-${key}`,
			hexFromArgb(value),
		]),
	);
}
