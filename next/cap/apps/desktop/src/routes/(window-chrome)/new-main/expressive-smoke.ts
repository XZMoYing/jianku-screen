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
		await win.show();
		await win.setFocus();
		await delay(200);
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
		const animationFramesAvailable = await Promise.race([
			new Promise<boolean>((resolve) =>
				requestAnimationFrame(() => resolve(true)),
			),
			delay(400).then(() => false),
		]);
		results.animationFramesAvailable = animationFramesAvailable;
		results.motionVerification = animationFramesAvailable
			? "foreground"
			: "pending-foreground-verification";
		if (animationFramesAvailable) {
			const mode = await waitFor(() =>
				document.querySelector<HTMLButtonElement>(".workspace-modes button"),
			);
			mode.dispatchEvent(
				new PointerEvent("pointerdown", {
					bubbles: true,
					button: 0,
					pointerId: 73,
				}),
			);
			await delay(750);
			const heldRaw = getComputedStyle(mode).getPropertyValue("scale");
			const held = Number.parseFloat(heldRaw);
			mode.dispatchEvent(
				new PointerEvent("pointerup", { bubbles: true, pointerId: 73 }),
			);
			await delay(750);
			const released = getComputedStyle(mode).getPropertyValue("scale");
			const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
			results.pressMotion = {
				heldRaw,
				held,
				released,
				reduced,
				visibility: document.visibilityState,
			};
			if (
				(!reduced &&
					(!Number.isFinite(held) || Math.abs(held - 0.96) > 0.001)) ||
				!["none", "1"].includes(released)
			)
				throw new Error("按钮未保持按压状态或松开后未复位");
			mode.dispatchEvent(
				new PointerEvent("pointerdown", {
					bubbles: true,
					button: 0,
					pointerId: 74,
				}),
			);
			await delay(80);
			mode.dispatchEvent(
				new PointerEvent("pointercancel", { bubbles: true, pointerId: 74 }),
			);
			await delay(750);
			results.cancelReleased =
				!mode.hasAttribute("data-jk-pressed") &&
				["none", "1"].includes(
					getComputedStyle(mode).getPropertyValue("scale"),
				);
			if (!results.cancelReleased) throw new Error("取消按压后未复位");
		}
		buttons()
			.find((button) => button.getAttribute("aria-label") === "砂岩渐变背景")
			?.click();
		await delay(250);
		for (const name of ["布局", "光标", "背景", "摄像与声音", "布局"]) {
			buttons()
				.find((button) => button.textContent?.trim() === name)
				?.click();
			await delay(30);
		}
		await press("布局");
		const slider = await waitFor(() =>
			Array.from(
				document.querySelectorAll<HTMLElement>(
					".jk-layout-settings .ed-slider",
				),
			)
				.find((element) =>
					element.parentElement?.parentElement?.textContent?.startsWith("留白"),
				)
				?.querySelector<HTMLElement>("[role=slider]"),
		);
		slider.focus();
		slider.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
		);
		for (let step = 0; step < 180; step++)
			slider.dispatchEvent(
				new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
			);
		slider.dispatchEvent(
			new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true }),
		);
		results.slider = {
			value: slider.getAttribute("aria-valuenow"),
			label: "留白",
		};
		const preview = await waitFor(() => {
			const canvas = document.querySelector<HTMLCanvasElement>(".jk-stage-gpu");
			return canvas && canvas.width > 300 ? canvas : null;
		});
		results.gpuPreview = {
			width: preview.width,
			height: preview.height,
			hasPixels: !!preview.getContext("2d")?.getImageData(0, 0, 1, 1).data[3],
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
		const presentationScroll = document.querySelector<HTMLElement>(
			'[data-testid="presentation-scroll"]',
		);
		results.presentationScroll = {
			height: presentationScroll?.clientHeight,
			scrollHeight: presentationScroll?.scrollHeight,
		};
		await press("录屏");
		await press("手机与平板");
		results.mobileLoadKeepsWorkspace =
			!!document.querySelector(".workspace-top");
		if (!results.mobileLoadKeepsWorkspace)
			throw new Error("设备加载隐藏了整个工作台");
		const mobile = await waitFor(() => {
			const element = document.querySelector<HTMLElement>(
				'[data-testid="mobile-recorder"]',
			);
			return element?.clientHeight ? element : null;
		});
		results.mobileScroll = {
			height: mobile?.clientHeight,
			scrollHeight: mobile?.scrollHeight,
		};
		if (!mobile?.clientHeight || getComputedStyle(mobile).overflowY !== "auto")
			throw new Error("移动设备设置无法滚动");
		await press("电脑屏幕");
		await win.setSize(new LogicalSize(1120, 800));
		await delay(300);
		results.wide = {
			width: innerWidth,
			height: innerHeight,
			horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
		};
		const selected = document.querySelector<HTMLElement>(
			".jk-appearance-tabs button[aria-pressed=true]",
		);
		const pill = document.querySelector<HTMLElement>(
			".jk-appearance-tabs .jk-selection-pill",
		);
		if (!selected || !pill) throw new Error("设置选中标记缺失");
		results.rapidTabs = {
			selected: selected.textContent,
			indicatorDelta: Math.abs(
				selected.getBoundingClientRect().left -
					pill.getBoundingClientRect().left,
			),
		};
		if (
			selected.textContent !== "布局" ||
			Math.abs(
				selected.getBoundingClientRect().left -
					pill.getBoundingClientRect().left,
			) > 1
		)
			throw new Error("快速切换后内容或选中标记未同步");
		const capturePanel = document.querySelector<HTMLElement>(
			'[data-testid="recording-panel"]',
		);
		results.captureControls = {
			scrollHeight: capturePanel?.scrollHeight,
			height: capturePanel?.clientHeight,
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
