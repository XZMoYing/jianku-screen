import { createQuery } from "@tanstack/solid-query";
import { convertFileSrc } from "@tauri-apps/api/core";
import { resolveResource } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	on,
	onCleanup,
	Show,
	Suspense,
} from "solid-js";
import { unwrap } from "solid-js/store";
import toast from "solid-toast";
import { AnimatedGradientEditor } from "~/routes/editor/AnimatedGradientEditor";
import { BrandColorsDropdown } from "~/routes/editor/BrandColorsDropdown";
import { hexToRgb, RgbInput } from "~/routes/editor/color-utils";
import { GradientEditor } from "~/routes/editor/GradientEditor";
import {
	DEFAULT_BACKGROUND_PADDING,
	DEFAULT_BACKGROUND_ROUNDING,
} from "~/routes/editor/projectConfig";
import { EditorButton } from "~/routes/editor/ui";
import { animatedGradientsStore } from "~/store";
import {
	BACKGROUND_CATEGORIES,
	type BackgroundCategory,
	backgroundCategory,
} from "~/utils/background-selection";
import { t } from "~/utils/i18n";
import type { OrganizationBrandColorSwatch } from "~/utils/organization-branding";
import { projectAssetPath } from "~/utils/project-files";
import {
	type BackgroundConfiguration,
	type BackgroundSource,
	commands,
} from "~/utils/tauri";
import IconLucideMonitor from "~icons/lucide/monitor";
import IconLucideRefreshCw from "~icons/lucide/refresh-cw";
import { MotionGroup, MotionSwitch } from "./InterfaceMotion";

const collections = [
	"local",
	"macOS",
	"dark",
	"blue",
	"cities",
	"purple",
	"orange",
] as const;
const wallpaperNames = [
	"macOS/tahoe-dusk-min",
	"macOS/tahoe-dawn-min",
	"macOS/tahoe-day-min",
	"macOS/tahoe-night-min",
	"macOS/tahoe-dark",
	"macOS/tahoe-light",
	"macOS/sequoia-dark",
	"macOS/sequoia-light",
	"macOS/sonoma-clouds",
	"macOS/sonoma-dark",
	"macOS/sonoma-evening",
	"macOS/sonoma-fromabove",
	"macOS/sonoma-horizon",
	"macOS/sonoma-light",
	"macOS/sonoma-river",
	"macOS/ventura-dark",
	"macOS/ventura-semi-dark",
	"macOS/ventura",
	...Array.from({ length: 6 }, (_, i) => `blue/${i + 1}`),
	...Array.from({ length: 6 }, (_, i) => `purple/${i + 1}`),
	...Array.from({ length: 6 }, (_, i) => `dark/${i + 1}`),
	...Array.from({ length: 9 }, (_, i) => `orange/${i + 1}`),
	...[
		"liverpool",
		"santorini",
		"miami",
		"monaco",
		"london",
		"rome",
		"sf",
		"nyc",
	].map((id) => `cities/${id}`),
];
const colors = [
	"#f7f4eb",
	"#d6cab1",
	"#e8c3af",
	"#b5c9b3",
	"#aad1ce",
	"#FF0000",
	"#FF4500",
	"#FF8C00",
	"#FFD700",
	"#FFFF00",
	"#ADFF2F",
	"#32CD32",
	"#008000",
	"#00CED1",
	"#4785FF",
	"#0000FF",
	"#4B0082",
	"#800080",
	"#A9A9A9",
	"#FFFFFF",
	"#000000",
	"#00000000",
];

type Material = { id: string; name: string; path: string; animated: boolean };
function MaterialTile(props: {
	material: Material;
	selected: boolean;
	onSelect: () => void;
}) {
	const preview = createQuery(() => ({
		queryKey: ["background-thumbnail", props.material.path],
		queryFn: () => commands.prepareBackgroundMedia(props.material.path, true),
		staleTime: Number.POSITIVE_INFINITY,
	}));
	return (
		<button
			type="button"
			class="jk-background-tile"
			aria-pressed={props.selected}
			title={t(props.material.name)}
			onClick={props.onSelect}
		>
			<Show
				when={preview.isPending ? undefined : preview.data}
				fallback={<span class="jk-material-loading" />}
			>
				{(path) => (
					<img
						loading="lazy"
						src={convertFileSrc(path())}
						alt={props.material.name}
					/>
				)}
			</Show>
			<span>
				{t(props.material.name)}
				{props.material.animated ? " ▷" : ""}
			</span>
		</button>
	);
}

export function BackgroundSettings(props: {
	background: BackgroundConfiguration;
	onChange: (
		patch: Partial<BackgroundConfiguration>,
		desktop?: boolean,
	) => void;
	projectPath?: string;
	desktopSelected?: boolean;
	brandColorSwatches?: OrganizationBrandColorSwatch[];
	pauseHistory?: () => () => void;
}) {
	const [category, setCategory] = createSignal<BackgroundCategory>(
		backgroundCategory(props.background.source, props.desktopSelected),
	);
	const [collection, setCollection] =
		createSignal<(typeof collections)[number]>("local");
	const [busy, setBusy] = createSignal(false);
	const [materialLimit, setMaterialLimit] = createSignal(24);
	let selectionRevision = 0;
	let disposed = false;
	let preferenceTimer: ReturnType<typeof setTimeout> | undefined;
	onCleanup(() => {
		disposed = true;
		clearTimeout(preferenceTimer);
	});
	const [drafts, setDrafts] = createSignal<
		Partial<Record<BackgroundSource["type"], BackgroundSource>>
	>({});
	const catalog = createQuery(() => ({
		queryKey: ["animated-gradient-catalog"],
		queryFn: () => commands.animatedGradientCatalog(),
		staleTime: Number.POSITIVE_INFINITY,
	}));
	const library = animatedGradientsStore.createQuery();
	const desktop = createQuery(() => ({
		queryKey: ["desktop-background", props.projectPath ?? "capture"],
		queryFn: () => commands.getDesktopWallpaper(props.projectPath ?? null),
		staleTime: Number.POSITIVE_INFINITY,
	}));
	const materials = createQuery(() => ({
		queryKey: ["local-background-materials"],
		queryFn: () => commands.listBackgroundMaterials(),
		staleTime: Number.POSITIVE_INFINITY,
	}));
	const wallpapers = createQuery(() => ({
		queryKey: ["bundled-wallpapers"],
		queryFn: async () =>
			Promise.all(
				wallpaperNames.map(async (id) => ({
					id,
					path: await resolveResource(`assets/backgrounds/${id}.jpg`),
				})),
			),
		staleTime: Number.POSITIVE_INFINITY,
	}));
	const fingerprint = () => JSON.stringify(props.background.source);
	createEffect(
		on(
			fingerprint,
			() => {
				const source = props.background.source;
				setDrafts((values) => ({
					...values,
					[source.type]: structuredClone(unwrap(source)),
				}));
			},
			{ defer: false },
		),
	);
	const candidate = <T extends BackgroundSource["type"]>(
		type: T,
		fallback: Extract<BackgroundSource, { type: T }>,
	): Extract<BackgroundSource, { type: T }> => {
		const current = props.background.source;
		const source = current.type === type ? current : drafts()[type];
		return source?.type === type
			? (source as Extract<BackgroundSource, { type: T }>)
			: fallback;
	};
	const apply = (source: BackgroundSource, desktop = false) => {
		const fromNone =
			props.background.padding === 0 && props.background.rounding === 0;
		props.onChange(
			{
				source,
				...(fromNone
					? {
							padding: DEFAULT_BACKGROUND_PADDING,
							rounding: DEFAULT_BACKGROUND_ROUNDING,
						}
					: {}),
			},
			desktop,
		);
		selectionRevision++;
		clearTimeout(preferenceTimer);
		const preference =
			source.type === "animatedGradient"
				? { lastUsed: structuredClone(unwrap(source.config)), selected: true }
				: { selected: false };
		preferenceTimer = setTimeout(
			() =>
				void animatedGradientsStore
					.set(preference)
					.catch((e: unknown) => toast.error(String(e))),
			200,
		);
	};
	const chooseMaterial = async (material: Material) => {
		const revision = ++selectionRevision;
		setBusy(true);
		try {
			const path = await commands.prepareBackgroundMedia(material.path, false);
			if (!disposed && revision === selectionRevision)
				apply({ type: "wallpaper", path });
		} catch (e) {
			toast.error(String(e));
		} finally {
			setBusy(false);
		}
	};
	const chooseImage = async () => {
		const path = await open({
			multiple: false,
			filters: [
				{
					name: t("图片或视频"),
					extensions: [
						"png",
						"jpg",
						"jpeg",
						"heic",
						"heif",
						"webp",
						"gif",
						"bmp",
						"mov",
						"mp4",
						"m4v",
					],
				},
			],
		});
		if (typeof path !== "string") return;
		setBusy(true);
		try {
			apply({
				type: "image",
				path: await commands.prepareBackgroundMedia(path, false),
			});
		} catch (e) {
			toast.error(String(e));
		} finally {
			setBusy(false);
		}
	};
	const selectedPath = () => {
		const source = props.background.source;
		return source.type === "wallpaper" || source.type === "image"
			? source.path
			: null;
	};
	const resolve = (path: string) =>
		props.projectPath ? projectAssetPath(props.projectPath, path) : path;
	const gradient = () =>
		candidate("gradient", {
			type: "gradient",
			from: [160, 144, 111],
			to: [241, 231, 206],
			angle: 135,
		});
	const color = () =>
		candidate("color", { type: "color", value: [247, 244, 235], alpha: 255 });
	const animated = createMemo(() =>
		candidate("animatedGradient", {
			type: "animatedGradient",
			config:
				(library.isPending ? undefined : library.data)?.lastUsed ??
				(catalog.isPending ? undefined : catalog.data)?.defaultConfig,
		} as Extract<BackgroundSource, { type: "animatedGradient" }>),
	);
	return (
		<div
			class="jk-background-settings"
			data-testid="background-settings"
			aria-busy={busy()}
		>
			<div class="jk-background-heading">
				<span>{t("背景")}</span>
				<EditorButton
					size="sm"
					onClick={() =>
						props.onChange(
							{
								source: { type: "color", value: [255, 255, 255], alpha: 0 },
								padding: 0,
								rounding: 0,
							},
							false,
						)
					}
				>
					{t("无")}
				</EditorButton>
			</div>
			<MotionGroup class="jk-background-tabs" label={t("背景素材分类")}>
				<For each={BACKGROUND_CATEGORIES}>
					{(item) => (
						<button
							type="button"
							data-background-category={item.id}
							aria-pressed={category() === item.id}
							onClick={() => setCategory(item.id)}
						>
							{t(item.name)}
						</button>
					)}
				</For>
			</MotionGroup>
			<MotionSwitch
				value={category()}
				kind="subpage"
				order={BACKGROUND_CATEGORIES.map((item) => item.id)}
			>
				{(panel) => (
					<Suspense
						fallback={
							<p class="jk-appearance-footnote">{t("正在准备素材…")}</p>
						}
					>
						<Show when={panel() === "desktop"}>
							<Show
								when={desktop.isPending ? undefined : desktop.data}
								fallback={
									<p class="jk-appearance-footnote">
										{desktop.isError
											? t("桌面壁纸读取失败，请重试")
											: t("正在读取当前桌面…")}
									</p>
								}
							>
								{(wallpaper) => (
									<button
										type="button"
										class="jk-desktop-background"
										data-testid="desktop-background-tile"
										aria-pressed={
											props.desktopSelected ??
											selectedPath() === wallpaper().path
										}
										onClick={() =>
											apply({ type: "wallpaper", path: wallpaper().path }, true)
										}
									>
										<img
											src={convertFileSrc(wallpaper().previewPath)}
											alt={t("当前桌面壁纸")}
										/>
										<span>
											<IconLucideMonitor />
											{wallpaper().animated
												? t("当前桌面 · 动态壁纸")
												: t("当前桌面壁纸")}
										</span>
									</button>
								)}
							</Show>
							<EditorButton
								onClick={() => void desktop.refetch()}
								disabled={desktop.isFetching}
								leftIcon={<IconLucideRefreshCw />}
							>
								{t("重新读取壁纸")}
							</EditorButton>
							<p class="jk-appearance-footnote">
								{t("点击预览应用当前壁纸。本机视频壁纸会按时间线循环播放。")}
							</p>
						</Show>
						<Show when={panel() === "wallpaper"}>
							<MotionGroup
								class="jk-background-collections"
								label={t("壁纸来源")}
							>
								<For each={collections}>
									{(item) => (
										<button
											type="button"
											aria-pressed={collection() === item}
											onClick={() => setCollection(item)}
										>
											{t(
												{
													local: "本机",
													macOS: "macOS",
													dark: "深色",
													blue: "蓝色",
													cities: "城市",
													purple: "紫色",
													orange: "橙色",
												}[item],
											)}
										</button>
									)}
								</For>
							</MotionGroup>
							<MotionSwitch
								value={collection()}
								kind="subpage"
								order={collections}
							>
								{(current) => (
									<div class="jk-background-grid">
										<Show
											when={current() === "local"}
											fallback={
												<For
													each={(wallpapers.isPending
														? undefined
														: wallpapers.data
													)?.filter((item) =>
														item.id.startsWith(`${current()}/`),
													)}
												>
													{(item) => (
														<button
															type="button"
															class="jk-background-tile"
															aria-pressed={
																selectedPath() === item.path ||
																selectedPath() === item.id
															}
															onClick={() =>
																apply({ type: "wallpaper", path: item.path })
															}
														>
															<img
																loading="lazy"
																src={convertFileSrc(
																	item.path.replace(/\.jpg$/, "-thumbnail.jpg"),
																)}
																alt={item.id.split("/").pop()}
															/>
														</button>
													)}
												</For>
											}
										>
											<For
												each={(materials.isPending ? undefined : materials.data)
													?.filter((item) => !item.id.startsWith("pattern-"))
													.slice(0, materialLimit())}
											>
												{(material) => (
													<MaterialTile
														material={material}
														selected={
															selectedPath() === material.path ||
															(material.id.startsWith("pattern-") &&
																selectedPath()?.split(/[\\/]/).pop() ===
																	material.path.split(/[\\/]/).pop())
														}
														onSelect={() => void chooseMaterial(material)}
													/>
												)}
											</For>
											<Show
												when={
													!materials.isPending &&
													!(
														materials.isPending ? undefined : materials.data
													)?.some((item) => !item.id.startsWith("pattern-"))
												}
											>
												<p>{t("未找到已下载的本机壁纸")}</p>
											</Show>
										</Show>
									</div>
								)}
							</MotionSwitch>
							<Show
								when={
									collection() === "local" &&
									((materials.isPending ? undefined : materials.data)?.filter(
										(item) => !item.id.startsWith("pattern-"),
									).length ?? 0) > materialLimit()
								}
							>
								<EditorButton
									onClick={() => setMaterialLimit((limit) => limit + 24)}
								>
									{t("显示更多壁纸")}
								</EditorButton>
							</Show>
							<EditorButton
								onClick={() => void materials.refetch()}
								disabled={materials.isFetching}
							>
								{t("刷新本机素材")}
							</EditorButton>
						</Show>
						<Show when={panel() === "pattern"}>
							<div class="jk-background-grid">
								<For
									each={(materials.isPending
										? undefined
										: materials.data
									)?.filter((item) => item.id.startsWith("pattern-"))}
								>
									{(material) => (
										<MaterialTile
											material={material}
											selected={
												selectedPath() === material.path ||
												(material.id.startsWith("pattern-") &&
													selectedPath()?.split(/[\\/]/).pop() ===
														material.path.split(/[\\/]/).pop())
											}
											onSelect={() => void chooseMaterial(material)}
										/>
									)}
								</For>
							</div>
						</Show>
						<Show when={panel() === "image"}>
							<Show
								when={candidate("image", { type: "image", path: null }).path}
							>
								{(path) => (
									<button
										type="button"
										class="jk-desktop-background"
										onClick={() => apply({ type: "image", path: path() })}
									>
										{/\.(mp4|mov|m4v)$/i.test(path()) ? (
											<video
												muted
												loop
												playsinline
												src={convertFileSrc(resolve(path()))}
											/>
										) : (
											<img
												src={convertFileSrc(resolve(path()))}
												alt={t("已选背景")}
											/>
										)}
									</button>
								)}
							</Show>
							<EditorButton
								onClick={() => void chooseImage()}
								disabled={busy()}
							>
								{t("选择图片或视频…")}
							</EditorButton>
						</Show>
						<Show when={panel() === "color"}>
							<RgbInput
								value={color().value}
								onChange={(value) => apply({ type: "color", value })}
							/>
							<BrandColorsDropdown
								swatches={props.brandColorSwatches ?? []}
								onSelect={(value) => {
									const rgb = hexToRgb(value);
									if (rgb)
										apply({
											type: "color",
											value: [rgb[0], rgb[1], rgb[2]],
											alpha: rgb[3],
										});
								}}
							/>
							<div class="jk-background-colors">
								<For each={colors}>
									{(value) => (
										<button
											type="button"
											title={value}
											aria-label={value}
											style={{
												background:
													value === "#00000000"
														? "repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 0 / 12px 12px"
														: value,
											}}
											onClick={() => {
												const rgb = hexToRgb(value);
												if (rgb)
													apply({
														type: "color",
														value: [rgb[0], rgb[1], rgb[2]],
														alpha: rgb[3],
													});
											}}
										/>
									)}
								</For>
							</div>
						</Show>
						<Show when={panel() === "gradient"}>
							<GradientEditor
								source={gradient()}
								onChange={apply}
								brandColorSwatches={props.brandColorSwatches ?? []}
							/>
						</Show>
						<Show when={panel() === "animatedGradient" && animated().config}>
							<AnimatedGradientEditor
								config={animated().config}
								onChange={(config) =>
									apply({ type: "animatedGradient", config })
								}
								brandColorSwatches={props.brandColorSwatches}
								pauseHistory={props.pauseHistory}
							/>
						</Show>
					</Suspense>
				)}
			</MotionSwitch>
			<Show when={materials.isError || desktop.isError}>
				<button
					type="button"
					class="jk-tonal-button"
					onClick={() => {
						void materials.refetch();
						void desktop.refetch();
					}}
				>
					{t("读取背景失败，点击重试")}
				</button>
			</Show>
		</div>
	);
}
