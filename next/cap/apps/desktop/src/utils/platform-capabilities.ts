import { type as ostype } from "@tauri-apps/plugin-os";

export function supportsScreenshotOcr(): boolean {
	const platform = ostype();
	return platform === "macos" || platform === "windows";
}
