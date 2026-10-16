import { convertFileSrc } from "@tauri-apps/api/core";
import type { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { remove } from "@tauri-apps/plugin-fs";
import { colorSchemeStore } from "~/store";
import { commands } from "~/utils/tauri";
import {
	colorSchemeDefaults,
	colorTokens,
	normalizeColorSettings,
	selectedSeed,
	wallpaperSeeds,
} from "./color-scheme";

let refreshing: Promise<string[]> | undefined;
export function refreshWallpaperColors(force = false): Promise<string[]> {
	if (refreshing) return refreshing;
	refreshing = (async () => {
		const settings = normalizeColorSettings(await colorSchemeStore.get());
		if (
			!force &&
			settings.wallpaperSeeds.length &&
			Date.now() - settings.wallpaperUpdatedAt < 60_000
		)
			return settings.wallpaperSeeds;
		const path = await commands.getCurrentWallpaperPreview();
		try {
			const image = new Image();
			image.crossOrigin = "anonymous";
			await new Promise<void>((resolve, reject) => {
				const timer = setTimeout(() => {
					image.src = "";
					reject(new Error("壁纸读取超时"));
				}, 10_000);
				image.onload = () => {
					clearTimeout(timer);
					resolve();
				};
				image.onerror = () => {
					clearTimeout(timer);
					reject(new Error("无法读取当前壁纸图像"));
				};
				image.src = convertFileSrc(path);
			});
			const canvas = document.createElement("canvas");
			canvas.width = 96;
			canvas.height = 96;
			const context = canvas.getContext("2d", { willReadFrequently: true });
			if (!context) throw new Error("无法创建壁纸取色画布");
			context.drawImage(image, 0, 0, 96, 96);
			const seeds = wallpaperSeeds(context.getImageData(0, 0, 96, 96).data);
			await colorSchemeStore.set({
				wallpaperSeeds: seeds,
				wallpaperUpdatedAt: Date.now(),
			});
			return seeds;
		} finally {
			await remove(path).catch((error) =>
				console.warn("Could not clear temporary wallpaper color sample", error),
			);
		}
	})().finally(() => {
		refreshing = undefined;
	});
	return refreshing;
}

export function installDynamicTheme(currentWindow: WebviewWindow) {
	let settings = colorSchemeDefaults;
	let disposed = false;
	let unlisten: (() => void) | undefined;
	let unfocus: (() => void) | undefined;
	let lastTheme = "";
	const apply = () => {
		const dark = document.documentElement.classList.contains("dark");
		const seed = selectedSeed(settings);
		const key = `${settings.source}:${seed}:${settings.variant}:${settings.contrast}:${dark}`;
		if (key === lastTheme || disposed) return;
		lastTheme = key;
		for (const [property, value] of Object.entries(
			colorTokens(seed, settings.variant, dark, settings.contrast),
		)) {
			document.documentElement.style.setProperty(property, value);
		}
		document.documentElement.dataset.jkColorSource = settings.source;
		document.documentElement.dataset.jkColorSeed = seed;
		try {
			localStorage.setItem(
				"jianku-color-css",
				JSON.stringify({
					light: colorTokens(seed, settings.variant, false, settings.contrast),
					dark: colorTokens(seed, settings.variant, true, settings.contrast),
				}),
			);
		} catch {}
	};
	const refresh = () => {
		if (settings.source === "wallpaper")
			void refreshWallpaperColors().catch((error) =>
				console.warn("Wallpaper color refresh unavailable", error),
			);
	};
	void colorSchemeStore
		.get()
		.then((value) => {
			if (disposed) return;
			settings = normalizeColorSettings(value);
			apply();
			if (currentWindow.label === "main") refresh();
		})
		.catch((error) => {
			apply();
			console.warn("Could not load color settings", error);
		});
	void colorSchemeStore
		.listen((value) => {
			settings = normalizeColorSettings(value);
			apply();
		})
		.then((stop) => {
			if (disposed) stop();
			else unlisten = stop;
		})
		.catch((error) => console.warn("Could not observe color settings", error));
	const observer = new MutationObserver(apply);
	observer.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["class"],
	});
	if (currentWindow.label === "main")
		void currentWindow
			.onFocusChanged(({ payload }) => {
				if (payload) refresh();
			})
			.then((stop) => {
				if (disposed) stop();
				else unfocus = stop;
			})
			.catch((error) =>
				console.warn("Could not observe wallpaper changes", error),
			);
	return () => {
		disposed = true;
		observer.disconnect();
		unlisten?.();
		unfocus?.();
	};
}
