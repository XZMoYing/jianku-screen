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

export type LeicaPresetId =
	| "graphite-vermilion"
	| "graphite-blue"
	| "graphite-mono"
	| "sapphire-dual";

export type ColorVariant =
	| "tonal"
	| "vibrant"
	| "expressive"
	| "neutral"
	| "mono";

export type ColorSchemeSettings = {
	source: "preset" | "wallpaper" | "custom";
	preset: LeicaPresetId;
	seed: string;
	variant: ColorVariant;
	contrast: number;
	wallpaperIndex: number;
	wallpaperSeeds: string[];
	wallpaperUpdatedAt: number;
};

export const leicaPresets: {
	id: LeicaPresetId;
	name: string;
	subtitle: string;
	swatch: string;
	accentHex: string;
	needleHex: string;
}[] = [
	{
		id: "graphite-vermilion",
		name: "黑红 · 纯粹莱卡",
		subtitle: "莱卡暗房 × 朱砂红（默认）",
		swatch: "linear-gradient(135deg, #282a2e 50%, #e23c1b 50%)",
		accentHex: "#e23c1b",
		needleHex: "#e23c1b",
	},
	{
		id: "graphite-blue",
		name: "黑蓝 · 适度蓝",
		subtitle: "石墨机身 × 蓝宝石焦标",
		swatch: "linear-gradient(135deg, #282a2e 50%, #0a7aff 50%)",
		accentHex: "#0a7aff",
		needleHex: "#0a7aff",
	},
	{
		id: "graphite-mono",
		name: "纯黑 · 钛灰单色",
		subtitle: "极致校色克制，零色偏干扰",
		swatch: "linear-gradient(135deg, #282a2e 50%, #66676b 50%)",
		accentHex: "#282a2e",
		needleHex: "#282a2e",
	},
	{
		id: "sapphire-dual",
		name: "双标 · 蓝焦红针",
		subtitle: "蓝宝石焦标 × 莱卡朱砂游标",
		swatch: "linear-gradient(135deg, #0a7aff 50%, #e23c1b 50%)",
		accentHex: "#0a7aff",
		needleHex: "#e23c1b",
	},
];

export const colorSchemeDefaults: ColorSchemeSettings = {
	source: "preset",
	preset: "graphite-vermilion",
	seed: "#e23c1b",
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
	{ name: "朱砂", hex: "#e23c1b" },
	{ name: "蓝宝石", hex: "#0a7aff" },
	{ name: "石墨", hex: "#646765" },
	{ name: "琥珀", hex: "#aa7900" },
	{ name: "松针", hex: "#337469" },
	{ name: "玫瑰", hex: "#a34d64" },
	{ name: "青绿", hex: "#10767f" },
	{ name: "胡桃", hex: "#8a6453" },
];

const validHex = (value: unknown): value is string =>
	typeof value === "string" && /^#[\da-f]{6}$/i.test(value);

export function normalizeColorSettings(
	value?: Partial<ColorSchemeSettings> | null,
) {
	const preset = leicaPresets.some((item) => item.id === value?.preset)
		? (value?.preset ?? colorSchemeDefaults.preset)
		: colorSchemeDefaults.preset;
	const source: ColorSchemeSettings["source"] =
		value?.source === "wallpaper" ||
		value?.source === "custom" ||
		value?.source === "preset"
			? value.source
			: colorSchemeDefaults.source;
	return {
		...colorSchemeDefaults,
		...value,
		source,
		preset,
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
	if (settings.source === "preset") {
		return (
			leicaPresets.find((item) => item.id === settings.preset)?.accentHex ??
			colorSchemeDefaults.seed
		);
	}
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

export function leicaPresetTokens(
	preset: LeicaPresetId,
	dark: boolean,
): Record<string, string> {
	const base = dark
		? {
				"--jk-surface": "#111214",
				"--jk-container-low": "#191a1e",
				"--jk-container": "#202227",
				"--jk-container-high": "#272a30",
				"--jk-container-highest": "#30333b",
				"--jk-paper": "#191a1e",
				"--jk-panel-hi": "#23252a",
				"--jk-well": "#0b0c0e",
				"--jk-well-deep": "#060708",
				"--jk-ink": "#f0f0ed",
				"--jk-muted": "#8c8e94",
				"--jk-outline": "#484b54",
				"--jk-outline-soft": "#2c2e35",
				"--jk-graphite": "#e6e6e2",
				"--jk-on-graphite": "#121315",
				"--jk-led": "#34cc68",
				"--jk-rec": "#ff4e2a",
				"--jk-error": "#ff5733",
				"--jk-on-error": "#ffffff",
			}
		: {
				"--jk-surface": "#e6e5e0",
				"--jk-container-low": "#efeee9",
				"--jk-container": "#e2e1db",
				"--jk-container-high": "#dcdbd5",
				"--jk-container-highest": "#d1d0c9",
				"--jk-paper": "#f4f3ef",
				"--jk-panel-hi": "#fbfaf7",
				"--jk-well": "#dcdbd5",
				"--jk-well-deep": "#d1d0c9",
				"--jk-ink": "#191a1c",
				"--jk-muted": "#66676b",
				"--jk-outline": "#9e9fa3",
				"--jk-outline-soft": "#d4d3ce",
				"--jk-graphite": "#282a2e",
				"--jk-on-graphite": "#f5f5f3",
				"--jk-led": "#2a9d55",
				"--jk-rec": "#e23c1b",
				"--jk-error": "#c83214",
				"--jk-on-error": "#ffffff",
			};

	const accentMap: Record<
		LeicaPresetId,
		{
			light: {
				primary: string;
				onPrimary: string;
				primaryContainer: string;
				onPrimaryContainer: string;
				secondary: string;
				secondaryContainer: string;
				tertiary: string;
				tertiaryContainer: string;
				needle: string;
			};
			dark: {
				primary: string;
				onPrimary: string;
				primaryContainer: string;
				onPrimaryContainer: string;
				secondary: string;
				secondaryContainer: string;
				tertiary: string;
				tertiaryContainer: string;
				needle: string;
			};
		}
	> = {
		"graphite-vermilion": {
			light: {
				primary: "#d13212",
				onPrimary: "#ffffff",
				primaryContainer: "#f8ddd7",
				onPrimaryContainer: "#7c1c08",
				secondary: "#4b4d52",
				secondaryContainer: "#e4e3dd",
				tertiary: "#b84528",
				tertiaryContainer: "#f5e3d8",
				needle: "#e23c1b",
			},
			dark: {
				primary: "#ff6644",
				onPrimary: "#1a0602",
				primaryContainer: "#4a1e16",
				onPrimaryContainer: "#ffd8ce",
				secondary: "#b8bac0",
				secondaryContainer: "#2a2c32",
				tertiary: "#ff8c6b",
				tertiaryContainer: "#3c231c",
				needle: "#ff5733",
			},
		},
		"graphite-blue": {
			light: {
				primary: "#006be6",
				onPrimary: "#ffffff",
				primaryContainer: "#dceaff",
				onPrimaryContainer: "#083a78",
				secondary: "#4b515c",
				secondaryContainer: "#e3e6ec",
				tertiary: "#2b6eb5",
				tertiaryContainer: "#dde9f7",
				needle: "#0a7aff",
			},
			dark: {
				primary: "#4da3ff",
				onPrimary: "#03162b",
				primaryContainer: "#173252",
				onPrimaryContainer: "#d2e7ff",
				secondary: "#b5bcc8",
				secondaryContainer: "#262b33",
				tertiary: "#7cb8ff",
				tertiaryContainer: "#1c2d42",
				needle: "#409cff",
			},
		},
		"graphite-mono": {
			light: {
				primary: "#282a2e",
				onPrimary: "#f5f5f3",
				primaryContainer: "#deddd8",
				onPrimaryContainer: "#191a1c",
				secondary: "#52545a",
				secondaryContainer: "#e5e4df",
				tertiary: "#3f4146",
				tertiaryContainer: "#dcdbd5",
				needle: "#282a2e",
			},
			dark: {
				primary: "#e6e6e2",
				onPrimary: "#121315",
				primaryContainer: "#303238",
				onPrimaryContainer: "#f0f0ed",
				secondary: "#b4b6bc",
				secondaryContainer: "#26282e",
				tertiary: "#c8cacf",
				tertiaryContainer: "#2c2e35",
				needle: "#e6e6e2",
			},
		},
		"sapphire-dual": {
			light: {
				primary: "#006be6",
				onPrimary: "#ffffff",
				primaryContainer: "#dceaff",
				onPrimaryContainer: "#083a78",
				secondary: "#4b4d52",
				secondaryContainer: "#e4e3dd",
				tertiary: "#d13212",
				tertiaryContainer: "#f8ddd7",
				needle: "#e23c1b",
			},
			dark: {
				primary: "#4da3ff",
				onPrimary: "#03162b",
				primaryContainer: "#173252",
				onPrimaryContainer: "#d2e7ff",
				secondary: "#b8bac0",
				secondaryContainer: "#2a2c32",
				tertiary: "#ff6644",
				tertiaryContainer: "#4a1e16",
				needle: "#ff5733",
			},
		},
	};

	const palette = dark ? accentMap[preset].dark : accentMap[preset].light;
	return {
		...base,
		"--jk-primary": palette.primary,
		"--jk-on-primary": palette.onPrimary,
		"--jk-primary-container": palette.primaryContainer,
		"--jk-on-primary-container": palette.onPrimaryContainer,
		"--jk-secondary": palette.secondary,
		"--jk-secondary-container": palette.secondaryContainer,
		"--jk-tertiary": palette.tertiary,
		"--jk-tertiary-container": palette.tertiaryContainer,
		"--jk-needle": palette.needle,
		"--jk-focus": palette.primary,
	};
}

export function colorTokens(
	seed: string,
	variant: ColorVariant,
	dark: boolean,
	contrast = 0,
): Record<string, string> {
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
		needle: scheme.primary,
	};
	return {
		...(dark
			? {
					"--jk-panel-hi": hexFromArgb(scheme.surfaceContainerHigh),
					"--jk-well": hexFromArgb(scheme.surfaceContainerLowest),
					"--jk-well-deep": "#060708",
					"--jk-graphite": "#e6e6e2",
					"--jk-on-graphite": "#121315",
					"--jk-led": "#34cc68",
					"--jk-rec": "#ff4e2a",
				}
			: {
					"--jk-panel-hi": "#fbfaf7",
					"--jk-well": hexFromArgb(scheme.surfaceContainerHigh),
					"--jk-well-deep": hexFromArgb(scheme.surfaceContainerHighest),
					"--jk-graphite": "#282a2e",
					"--jk-on-graphite": "#f5f5f3",
					"--jk-led": "#2a9d55",
					"--jk-rec": "#e23c1b",
				}),
		...Object.fromEntries(
			Object.entries(colors).map(([key, value]) => [
				`--jk-${key}`,
				hexFromArgb(value),
			]),
		),
	};
}

export function resolveColorTokens(
	settings: ColorSchemeSettings,
	dark: boolean,
): Record<string, string> {
	if (settings.source === "preset") {
		return leicaPresetTokens(settings.preset, dark);
	}
	return colorTokens(
		selectedSeed(settings),
		settings.variant,
		dark,
		settings.contrast,
	);
}
