import type {
	EditorPreviewQuality,
	PreviewCanvasConfiguration,
	PreviewResolutionOption,
	ProjectConfiguration,
} from "~/utils/tauri";

export const DEFAULT_PREVIEW_QUALITY: EditorPreviewQuality = "720p";

export function readPreviewQuality(value: unknown): EditorPreviewQuality {
	if (value === "quarter") return "360p";
	if (value === "half") return "720p";
	if (value === "full") return "1080p";
	if (
		value === "144p" ||
		value === "360p" ||
		value === "480p" ||
		value === "540p" ||
		value === "720p" ||
		value === "1080p" ||
		value === "1440p" ||
		value === "2160p" ||
		value === "original"
	) {
		return value;
	}
	return DEFAULT_PREVIEW_QUALITY;
}

export function previewCanvasConfiguration(
	project: Pick<ProjectConfiguration, "aspectRatio" | "background">,
): PreviewCanvasConfiguration {
	return {
		aspectRatio: project.aspectRatio ?? null,
		crop: project.background.crop ?? null,
		padding: project.background.padding,
	};
}

export function selectPreviewResolution(
	options: readonly PreviewResolutionOption[],
	preference: EditorPreviewQuality,
): PreviewResolutionOption {
	const selected = options.find(
		(option) => option.quality === preference && option.available,
	);
	const original = options.find(
		(option) => option.quality === "original" && option.available,
	);
	if (selected) return selected;
	if (original) return original;
	throw new Error("Preview resolutions unavailable");
}

export function previewQualityLabel(option: PreviewResolutionOption) {
	if (option.quality === "original")
		return option.limited ? "最高可用" : "原始清晰度";
	if (option.quality === "1440p") return "2K（1440p）";
	if (option.quality === "2160p") return "4K（2160p）";
	return option.quality;
}
