import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { colorSchemeStore } from "~/store";
import { normalizeColorSettings, selectedSeed } from "~/utils/color-scheme";
import { refreshWallpaperColors } from "~/utils/dynamic-theme";
import { commands } from "~/utils/tauri";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor<T>(
	read: () => T | null | undefined | false,
): Promise<T> {
	const deadline = performance.now() + 12_000;
	while (performance.now() < deadline) {
		const result = read();
		if (result) return result;
		await delay(50);
	}
	throw new Error("界面未就绪");
}
export async function runExpressiveSmoke() {
	if (
		!(window as typeof window & { __CAP__?: { expressiveSmoke?: boolean } })
			.__CAP__?.expressiveSmoke
	)
		return false;
	const results: Record<string, unknown> = { userMediaSaved: false };
	const stage = async (name: string) => {
		results.stage = name;
		await emit("jianku-expressive-smoke-result", results);
	};
	const win = getCurrentWindow();
	const size = await win.innerSize();
	const initial = await commands.getCaptureStyle();
	try {
		await waitFor(() =>
			document.querySelector('[data-testid="capture-appearance"] fieldset'),
		);
		await stage("appearance-loaded");
		results.permissions = await commands.doPermissionsCheck(false);
		results.theme = {
			dark: document.documentElement.classList.contains("dark"),
			surface: getComputedStyle(document.documentElement)
				.getPropertyValue("--jk-surface")
				.trim(),
		};
		results.noSlogan =
			!document.body.textContent?.includes("录下精彩，呈现细节");
		const buttons = () =>
			Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
		const press = async (label: string) => {
			const button = await waitFor(() =>
				buttons().find(
					(b) => b.textContent?.trim() === label && !b.matches(":disabled"),
				),
			);
			button.click();
			await delay(250);
		};
		const fieldset = document.querySelector<HTMLFieldSetElement>(
			".jk-appearance fieldset",
		);
		results.before = {
			disabled: fieldset?.disabled,
			inert: !!fieldset?.closest("[inert]"),
			controls: Array.from(
				document.querySelectorAll<HTMLButtonElement>(
					".jk-appearance-tabs button",
				),
			).map((b) => ({
				label: b.textContent,
				disabled: b.matches(":disabled"),
				selected: b.getAttribute("aria-pressed"),
			})),
		};
		await stage("before-layout-switch");
		await press("布局");
		await waitFor(() =>
			Array.from(
				document.querySelectorAll<HTMLLabelElement>(".jk-appearance label"),
			).find((label) => label.textContent?.startsWith("留白")),
		);
		const slider = await waitFor(() =>
			document.querySelector<HTMLInputElement>(
				'.jk-appearance input[type="range"]',
			),
		);
		slider.value = "18";
		slider.dispatchEvent(new Event("input", { bubbles: true }));
		results.slider = {
			label: slider.closest("label")?.textContent,
			value: slider.value,
		};
		let saved = await commands.getCaptureStyle();
		for (
			let attempt = 0;
			attempt < 12 && saved.config.background.padding !== 18;
			attempt++
		) {
			await delay(150);
			saved = await commands.getCaptureStyle();
		}
		if (saved.config.background.padding !== 18)
			throw new Error(
				`录前设置没有保存: ${document.querySelector(".jk-appearance-state")?.textContent}`,
			);

		results.captureStyleSaved = true;
		await press("演示");
		await delay(400);
		const setup = await commands.getPresentationSetup();
		results.presentationStyleApplied =
			setup.options.project.background.padding === 18;
		if (!results.presentationStyleApplied)
			throw new Error("演示未使用共用画面设置");
		await press("录屏");
		await win.setSize(new LogicalSize(1120, 800));
		await delay(300);
		results.wide = {
			width: innerWidth,
			height: innerHeight,
			horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
		};
		await stage("wide-layout");
		await delay(1800);
		await win.setSize(new LogicalSize(660, 530));
		await delay(300);
		const body = document.querySelector<HTMLElement>(".jk-workspace-body");
		results.narrow = {
			width: innerWidth,
			height: innerHeight,
			scrolls: !!body && body.scrollHeight > body.clientHeight,
			horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
		};
		if (!body || body.scrollHeight <= body.clientHeight)
			throw new Error("小窗口无法滚动");
		body.scrollTop = body.scrollHeight;
		await stage("narrow-layout");
		await delay(1000);
		await win.setSize(size);
		await delay(300);
		const path = await commands.getCurrentWallpaperPreview();
		results.currentWallpaper = {
			available: !!path,
			uniqueFile: /wallpaper-[a-f0-9-]+\.jpg$/.test(path),
		};
		await stage("wallpaper-read");
		await refreshWallpaperColors(true);
		const colors = normalizeColorSettings(await colorSchemeStore.get());
		try {
			results.wallpaperColors = {
				count: colors.wallpaperSeeds.length,
				seed: selectedSeed(colors),
			};
			await colorSchemeStore.set({
				source: "custom",
				seed: "#b66e4c",
				variant: "tonal",
			});
			await waitFor(
				() => document.documentElement.dataset.jkColorSeed === "#b66e4c",
			);
			results.customColorApplied = true;
		} finally {
			await colorSchemeStore.set(colors);
			await waitFor(
				() =>
					document.documentElement.dataset.jkColorSeed === selectedSeed(colors),
			);
		}
		results.wallpaperColorRestored = true;
		await stage("wallpaper-colors");
		results.ok = true;
	} catch (error) {
		results.ok = false;
		results.error = String(error);
	} finally {
		await commands.setCaptureStyle(initial);
		await win.setSize(size);
		await emit("jianku-expressive-smoke-result", results);
	}
	return true;
}
