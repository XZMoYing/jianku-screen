import type {
	MobileCaptureOrientation,
	MobileCaptureSettings,
} from "~/utils/tauri";

export const mobileCaptureDefaults: MobileCaptureSettings = {
	maxSize: 0,
	maxFps: 60,
	bitRateMbps: 16,
	orientation: "initial",
};

export const mobileSizeOptions = [
	{ value: 0, label: "原始尺寸" },
	{ value: 1280, label: "长边最高 1280 px" },
	{ value: 1920, label: "长边最高 1920 px" },
	{ value: 2560, label: "长边最高 2560 px" },
	{ value: 3840, label: "长边最高 3840 px" },
];

export const mobileOrientationOptions: {
	value: MobileCaptureOrientation;
	label: string;
}[] = [
	{ value: "initial", label: "保持开始时的方向" },
	{ value: "natural", label: "设备原生方向" },
	{ value: "rotate90", label: "原生方向顺时针 90°" },
	{ value: "rotate180", label: "原生方向旋转 180°" },
	{ value: "rotate270", label: "原生方向顺时针 270°" },
];

export function parseMobileCaptureSettings(
	serialized: string,
): MobileCaptureSettings {
	try {
		const value: unknown = JSON.parse(serialized);
		if (typeof value !== "object" || value === null)
			return { ...mobileCaptureDefaults };
		const settings = value as Record<string, unknown>;
		const orientation = mobileOrientationOptions.find(
			(option) => option.value === settings.orientation,
		)?.value;
		return {
			maxSize:
				typeof settings.maxSize === "number" &&
				mobileSizeOptions.some((option) => option.value === settings.maxSize)
					? settings.maxSize
					: mobileCaptureDefaults.maxSize,
			maxFps:
				settings.maxFps === 30 || settings.maxFps === 60
					? settings.maxFps
					: mobileCaptureDefaults.maxFps,
			bitRateMbps:
				settings.bitRateMbps === 8 ||
				settings.bitRateMbps === 16 ||
				settings.bitRateMbps === 32
					? settings.bitRateMbps
					: mobileCaptureDefaults.bitRateMbps,
			orientation: orientation ?? mobileCaptureDefaults.orientation,
		};
	} catch {
		return { ...mobileCaptureDefaults };
	}
}
