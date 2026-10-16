import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
	createMemo,
	createResource,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import { unwrap } from "solid-js/store";
import toast from "solid-toast";
import {
	ASPECT_RATIO_OPTIONS,
	ASPECT_RATIOS,
} from "~/routes/editor/projectConfig";
import { generalSettingsStore } from "~/store";
import { createPresets } from "~/utils/createPresets";
import {
	type AspectRatio,
	type BackgroundSource,
	type CaptureStyle,
	type CursorAnimationStyle,
	type CursorType,
	commands,
	type FrameStyle,
} from "~/utils/tauri";

const gradients: {
	name: string;
	from: [number, number, number];
	to: [number, number, number];
}[] = [
	{ name: "砂岩", from: [160, 144, 111], to: [241, 231, 206] },
	{ name: "海盐", from: [83, 148, 184], to: [199, 231, 218] },
	{ name: "杏色", from: [228, 157, 139], to: [250, 227, 176] },
	{ name: "清苔", from: [123, 158, 129], to: [222, 232, 196] },
	{ name: "深空", from: [25, 31, 56], to: [102, 84, 154] },
];
const cursorPresets: {
	id: CursorAnimationStyle;
	name: string;
	tension: number;
	mass: number;
	friction: number;
}[] = [
	{ id: "slow", name: "舒缓", tension: 200, mass: 2.25, friction: 40 },
	{ id: "smooth", name: "平滑", tension: 80, mass: 2.5, friction: 28 },
	{ id: "mellow", name: "自然", tension: 470, mass: 3, friction: 70 },
	{ id: "fast", name: "灵敏", tension: 380, mass: 1, friction: 30 },
];
const frames: { id: FrameStyle; name: string }[] = [
	{ id: "none", name: "无外框" },
	{ id: "macOS", name: "桌面窗口" },
	{ id: "browser", name: "浏览器" },
	{ id: "macbook", name: "笔记本" },
	{ id: "phone", name: "手机" },
	{ id: "tablet", name: "平板" },
];
const rgb = (v: readonly number[]) => `rgb(${v.join(",")})`;
export function appearanceBackground(source: BackgroundSource): string {
	switch (source.type) {
		case "gradient":
			return `linear-gradient(${source.angle ?? 90}deg, ${rgb(source.from)}, ${rgb(source.to)})`;
		case "image":
		case "wallpaper":
			return source.path
				? `url("${convertFileSrc(source.path)}")`
				: "var(--jk-container)";
		case "color":
			return `rgba(${source.value.join(",")}, ${(source.alpha ?? 255) / 255})`;
		case "animatedGradient":
			return `linear-gradient(${source.config.direction}deg, ${source.config.colorStops.map((s) => rgb(s.color)).join(",")})`;
	}
}
function Range(props: {
	name: string;
	value: number;
	max: number;
	min?: number;
	step?: number;
	change: (v: number) => void;
	unit?: string;
}) {
	return (
		<label class="jk-control-row">
			<span>{props.name}</span>
			<input
				type="range"
				min={props.min ?? 0}
				max={props.max}
				step={props.step ?? 1}
				value={props.value}
				style={{
					"--jk-progress": `${((props.value - (props.min ?? 0)) / (props.max - (props.min ?? 0))) * 100}%`,
				}}
				onInput={(e) => props.change(e.currentTarget.valueAsNumber)}
			/>
			<output>
				{Number(props.value.toFixed(1))}
				{props.unit}
			</output>
		</label>
	);
}
function Check(props: {
	name: string;
	value: boolean;
	change: (v: boolean) => void;
}) {
	return (
		<label class="jk-control-row">
			<span>{props.name}</span>
			<input
				type="checkbox"
				checked={props.value}
				onChange={(e) => props.change(e.currentTarget.checked)}
			/>
		</label>
	);
}
export default function CaptureAppearance(props: {
	blocked: boolean;
	onStyle: (style: CaptureStyle) => void;
	onBusy: (busy: boolean) => void;
}) {
	const [style, setStyle] = createSignal<CaptureStyle>();
	const [tab, setTab] = createSignal("background");
	const [saving, setSaving] = createSignal(false);
	const [error, setError] = createSignal("");
	const presets = createPresets();
	const general = generalSettingsStore.createQuery();
	const [catalog] = createResource(() => commands.animatedGradientCatalog());
	let pending: CaptureStyle | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let writing = false;
	let disposed = false;
	const save = async () => {
		timer = undefined;
		if (writing) return;
		writing = true;
		try {
			while (pending) {
				const next = pending;
				pending = undefined;
				await commands.setCaptureStyle(next);
			}
			if (!disposed) setError("");
		} catch (e) {
			if (!disposed) {
				setError(String(e));
				toast.error("画面设置未保存，请重试");
			}
		} finally {
			writing = false;
			if (!disposed) {
				setSaving(false);
				props.onBusy(!!error());
			}
		}
	};
	const update = (change: (next: CaptureStyle) => void) => {
		const current = style();
		if (!current || props.blocked) return;
		const next = structuredClone(current);
		change(next);
		setStyle(next);
		props.onStyle(next);
		pending = next;
		setSaving(true);
		props.onBusy(true);
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => void save(), 120);
	};
	const wallpaper = async () => {
		props.onBusy(true);
		try {
			const path = await commands.getCurrentWallpaperPreview();
			if (!disposed)
				update((s) => {
					s.desktopWallpaper = true;
					s.config.background.source = { type: "image", path };
				});
		} catch (e) {
			setError(String(e));
			toast.error(String(e));
		} finally {
			if (!saving()) props.onBusy(false);
		}
	};
	const background = (source: BackgroundSource) =>
		update((s) => {
			s.desktopWallpaper = false;
			s.config.background.source = source;
		});
	const image = async () => {
		const path = await open({
			multiple: false,
			filters: [
				{ name: "图片", extensions: ["png", "jpg", "jpeg", "heic", "webp"] },
			],
		});
		if (typeof path === "string") background({ type: "image", path });
	};
	const load = async () => {
		props.onBusy(true);
		try {
			const value = await commands.getCaptureStyle();
			await commands.setCaptureStyle(value);
			if (disposed) return;
			setStyle(value);
			setError("");
			props.onStyle(value);
		} catch (e) {
			if (!disposed) setError(String(e));
		} finally {
			if (!disposed) props.onBusy(!!error());
		}
	};
	onMount(() => {
		void load();
	});
	onCleanup(() => {
		disposed = true;
		if (timer) clearTimeout(timer);
		if (pending) void save();
	});
	const preview = createMemo(() => {
		const value = style();
		return value
			? appearanceBackground(value.config.background.source)
			: "var(--jk-container)";
	});
	return (
		<aside
			class="jk-appearance"
			aria-label="捕获前画面设置"
			data-testid="capture-appearance"
		>
			<Show
				when={style()}
				fallback={
					<div class="jk-appearance-controls">
						{error() || "正在载入画面设置…"}
					</div>
				}
			>
				{(value) => (
					<>
						<div class="jk-appearance-preview" aria-label="画面布局示意">
							<div
								class="jk-preview-background"
								style={{
									background: preview(),
									"background-size": "cover",
									"background-position": "center",
									filter: `blur(${value().config.background.blur / 4}px)`,
								}}
							/>
							<div
								class="jk-preview-screen"
								style={{
									width: `${Math.max(35, 100 - value().config.background.padding * 2)}%`,
									"border-radius": `${value().config.background.rounding}px`,
									padding: `${value().config.background.inset / 8}px`,
									"box-shadow": `0 ${value().config.background.shadow / 3}px ${value().config.background.advancedShadow?.blur ?? value().config.background.shadow}px #17121f38`,
								}}
							>
								<div class="jk-preview-chrome">
									<i />
									<i />
									<i />
								</div>
								<div class="jk-preview-content">
									<div class="jk-preview-rail" />
									<div class="jk-preview-document">
										<i />
										<i />
										<i />
										<i />
									</div>
								</div>
							</div>
							<span class="jk-preview-caption">布局示意</span>
						</div>
						<fieldset class="jk-appearance-controls" disabled={props.blocked}>
							<div
								class="jk-appearance-tabs"
								role="group"
								aria-label="画面设置分组"
							>
								<For
									each={[
										{ id: "background", name: "背景" },
										{ id: "layout", name: "布局" },
										{ id: "cursor", name: "光标" },
										{ id: "camera", name: "摄像与声音" },
									]}
								>
									{(item) => (
										<button
											type="button"
											aria-pressed={tab() === item.id}
											onClick={() => setTab(item.id)}
										>
											{item.name}
										</button>
									)}
								</For>
							</div>
							<Show when={tab() === "background"}>
								<div class="jk-swatches">
									<For each={gradients}>
										{(g) => (
											<button
												type="button"
												title={g.name}
												aria-label={`${g.name}渐变背景`}
												aria-pressed={
													value().config.background.source.type ===
														"gradient" &&
													JSON.stringify(
														(
															value().config.background.source as {
																from?: number[];
															}
														).from,
													) === JSON.stringify(g.from)
												}
												style={{
													background: `linear-gradient(135deg, ${rgb(g.from)}, ${rgb(g.to)})`,
												}}
												onClick={() =>
													background({
														type: "gradient",
														from: g.from,
														to: g.to,
														angle: 135,
													})
												}
											/>
										)}
									</For>
								</div>
								<div class="jk-appearance-actions">
									<button
										type="button"
										class="jk-tonal-button"
										onClick={() => void wallpaper()}
									>
										{value().desktopWallpaper ? "刷新当前壁纸" : "使用当前壁纸"}
									</button>
									<button
										type="button"
										class="jk-tonal-button"
										onClick={() => void image()}
									>
										选择图片
									</button>
									<button
										type="button"
										class="jk-tonal-button"
										onClick={() =>
											background({
												type: "color",
												value: [255, 255, 255],
												alpha: 0,
											})
										}
									>
										透明
									</button>
								</div>
								<label class="jk-control-row">
									<span>纯色</span>
									<input
										type="color"
										aria-label="背景颜色"
										value={
											value().config.background.source.type === "color"
												? `#${(value().config.background.source as { value: number[] }).value.map((n) => n.toString(16).padStart(2, "0")).join("")}`
												: "#eee8f6"
										}
										onInput={(e) => {
											const h = e.currentTarget.value;
											background({
												type: "color",
												value: [
													Number.parseInt(h.slice(1, 3), 16),
													Number.parseInt(h.slice(3, 5), 16),
													Number.parseInt(h.slice(5, 7), 16),
												],
												alpha: 255,
											});
										}}
									/>
								</label>
								<Range
									name="背景模糊"
									value={value().config.background.blur}
									max={100}
									change={(n) =>
										update((s) => {
											s.config.background.blur = n;
										})
									}
								/>
								<label class="jk-control-row">
									<span>动态背景</span>
									<select
										aria-label="动态背景预设"
										value=""
										onChange={(e) => {
											const template =
												catalog()?.templates[Number(e.currentTarget.value)];
											if (template)
												background({
													type: "animatedGradient",
													config: structuredClone(template.config),
												});
										}}
									>
										<option value="" disabled>
											选择动态背景
										</option>
										<For each={catalog()?.templates}>
											{(template, i) => (
												<option value={i()}>{template.name}</option>
											)}
										</For>
									</select>
								</label>
								<Show
									when={
										value().config.background.source.type === "animatedGradient"
									}
								>
									<Range
										name="流动速度"
										value={((source) =>
											source.type === "animatedGradient"
												? source.config.motionSpeed
												: 40)(value().config.background.source)}
										max={100}
										change={(n) =>
											update((s) => {
												if (
													s.config.background.source.type === "animatedGradient"
												)
													s.config.background.source.config.motionSpeed = n;
											})
										}
									/>
								</Show>
								<Show when={value().desktopWallpaper}>
									<p class="jk-appearance-footnote">
										开始捕获时重新读取当前壁纸，并将图像保存进工程。
									</p>
								</Show>
							</Show>
							<Show when={tab() === "layout"}>
								<label class="jk-control-row">
									<span>画面比例</span>
									<select
										aria-label="捕获画面比例"
										value={value().config.aspectRatio ?? "auto"}
										onChange={(e) =>
											update((s) => {
												s.config.aspectRatio =
													e.currentTarget.value === "auto"
														? null
														: (e.currentTarget.value as AspectRatio);
											})
										}
									>
										<For each={ASPECT_RATIO_OPTIONS}>
											{(r) => (
												<option
													value={r}
													selected={
														(value().config.aspectRatio ?? "auto") === r
													}
												>
													{r === "auto"
														? "适合屏幕"
														: `${ASPECT_RATIOS[r].ratio.join(":")} · ${ASPECT_RATIOS[r].name}`}
												</option>
											)}
										</For>
									</select>
								</label>
								<Range
									name="留白"
									value={value().config.background.padding}
									max={40}
									unit="%"
									change={(n) =>
										update((s) => {
											s.config.background.padding = n;
										})
									}
								/>
								<Range
									name="圆角"
									value={value().config.background.rounding}
									max={100}
									change={(n) =>
										update((s) => {
											s.config.background.rounding = n;
										})
									}
								/>
								<Range
									name="内边距"
									value={value().config.background.inset}
									max={100}
									change={(n) =>
										update((s) => {
											s.config.background.inset = n;
										})
									}
								/>
								<Range
									name="阴影"
									value={value().config.background.shadow}
									max={100}
									change={(n) =>
										update((s) => {
											s.config.background.shadow = n;
										})
									}
								/>
								<details>
									<summary class="jk-appearance-footnote">阴影细节</summary>
									<For
										each={
											[
												{ key: "size", name: "扩散" },
												{ key: "opacity", name: "不透明度" },
												{ key: "blur", name: "柔化" },
											] as const
										}
									>
										{(field) => (
											<Range
												name={field.name}
												value={
													value().config.background.advancedShadow?.[
														field.key
													] ?? 50
												}
												max={100}
												change={(n) =>
													update((s) => {
														s.config.background.advancedShadow ??= {
															size: 50,
															opacity: 50,
															blur: 50,
														};
														s.config.background.advancedShadow[field.key] = n;
													})
												}
											/>
										)}
									</For>
								</details>
								<label class="jk-control-row">
									<span>外框</span>
									<select
										aria-label="录制外框"
										value={value().config.background.frame?.style ?? "none"}
										onChange={(e) =>
											update((s) => {
												s.config.background.frame = {
													style: e.currentTarget.value as FrameStyle,
													theme: "light",
													title: "",
													url: "",
												};
											})
										}
									>
										<For each={frames}>
											{(f) => (
												<option
													value={f.id}
													selected={
														(value().config.background.frame?.style ??
															"none") === f.id
													}
												>
													{f.name}
												</option>
											)}
										</For>
									</select>
								</label>
								<Show
									when={
										value().config.background.frame &&
										value().config.background.frame?.style !== "none"
									}
								>
									<Check
										name="浅色外框"
										value={value().config.background.frame?.theme === "light"}
										change={(b) =>
											update((s) => {
												if (s.config.background.frame)
													s.config.background.frame.theme = b
														? "light"
														: "dark";
											})
										}
									/>
								</Show>
								<Check
									name="细边框"
									value={value().config.background.border?.enabled ?? false}
									change={(b) =>
										update((s) => {
											s.config.background.border = {
												enabled: b,
												width: s.config.background.border?.width ?? 1,
												color: s.config.background.border?.color ?? [
													255, 255, 255,
												],
												opacity: s.config.background.border?.opacity ?? 50,
											};
										})
									}
								/>
							</Show>
							<Show when={tab() === "cursor"}>
								<label class="jk-control-row">
									<span>光标样式</span>
									<select
										aria-label="光标样式"
										value={value().config.cursor.type}
										onChange={(e) =>
											update((s) => {
												s.config.cursor.type = e.currentTarget
													.value as CursorType;
											})
										}
									>
										<For
											each={[
												{ id: "auto", name: "自动" },
												{ id: "macos", name: "经典箭头" },
												{ id: "tahoe", name: "圆润箭头" },
												{ id: "windows", name: "细边箭头" },
												{ id: "pointer", name: "标准指针" },
												{ id: "circle", name: "圆点" },
											]}
										>
											{(item) => (
												<option
													value={item.id}
													selected={value().config.cursor.type === item.id}
												>
													{item.name}
												</option>
											)}
										</For>
									</select>
								</label>
								<Check
									name="显示光标"
									value={!value().config.cursor.hide}
									change={(b) =>
										update((s) => {
											s.config.cursor.hide = !b;
										})
									}
								/>
								<Range
									name="光标大小"
									min={50}
									max={300}
									value={value().config.cursor.size}
									unit="%"
									change={(n) =>
										update((s) => {
											s.config.cursor.size = n;
										})
									}
								/>
								<label class="jk-control-row">
									<span>移动风格</span>
									<select
										aria-label="光标移动风格"
										value={value().config.cursor.animationStyle}
										onChange={(e) => {
											const preset = cursorPresets.find(
												(p) => p.id === e.currentTarget.value,
											);
											if (preset)
												update((s) => {
													Object.assign(s.config.cursor, {
														animationStyle: preset.id,
														tension: preset.tension,
														mass: preset.mass,
														friction: preset.friction,
													});
												});
										}}
									>
										<For each={cursorPresets}>
											{(p) => (
												<option
													value={p.id}
													selected={
														value().config.cursor.animationStyle === p.id
													}
												>
													{p.name}
												</option>
											)}
										</For>
										<option
											value="custom"
											selected={
												value().config.cursor.animationStyle === "custom"
											}
										>
											自定义
										</option>
									</select>
								</label>
								<Range
									name="移动倾斜"
									value={(value().config.cursor.rotationAmount ?? 0.15) * 100}
									max={100}
									change={(n) =>
										update((s) => {
											s.config.cursor.rotationAmount = n / 100;
										})
									}
								/>
								<Range
									name="动态模糊"
									value={value().config.cursor.motionBlur}
									max={1}
									step={0.01}
									change={(n) =>
										update((s) => {
											s.config.cursor.motionBlur = n;
										})
									}
								/>
								<Check
									name="静止时隐藏"
									value={value().config.cursor.hideWhenIdle}
									change={(b) =>
										update((s) => {
											s.config.cursor.hideWhenIdle = b;
										})
									}
								/>
								<Range
									name="隐藏等待"
									value={value().config.cursor.hideWhenIdleDelay}
									min={0.5}
									max={5}
									step={0.1}
									unit="s"
									change={(n) =>
										update((s) => {
											s.config.cursor.hideWhenIdleDelay = n;
										})
									}
								/>
								<Check
									name="点击波纹"
									value={value().config.cursor.ripple?.enabled ?? false}
									change={(b) =>
										update((s) => {
											s.config.cursor.ripple = {
												enabled: b,
												color: [180, 158, 255],
												strength: 0.6,
												size: 1,
												duration: 0.5,
											};
										})
									}
								/>
								<Range
									name="画面动态模糊"
									value={value().config.screenMotionBlur ?? 0}
									max={1}
									step={0.01}
									change={(n) =>
										update((s) => {
											s.config.screenMotionBlur = n;
										})
									}
								/>
							</Show>
							<Show when={tab() === "camera"}>
								<Check
									name="录制后自动运镜"
									value={general.data?.autoZoomOnClicks ?? true}
									change={(b) => {
										void generalSettingsStore
											.set({ autoZoomOnClicks: b })
											.catch((e: unknown) => toast.error(String(e)));
									}}
								/>
								<Range
									name="默认放大倍率"
									value={general.data?.defaultZoomAmount ?? 1.5}
									min={1.1}
									max={3}
									step={0.1}
									unit="×"
									change={(n) => {
										void generalSettingsStore
											.set({ defaultZoomAmount: n })
											.catch((e: unknown) => toast.error(String(e)));
									}}
								/>
								<Check
									name="显示摄像头"
									value={!value().config.camera.hide}
									change={(b) =>
										update((s) => {
											s.config.camera.hide = !b;
										})
									}
								/>
								<Check
									name="摄像头镜像"
									value={value().config.camera.mirror}
									change={(b) =>
										update((s) => {
											s.config.camera.mirror = b;
										})
									}
								/>
								<Range
									name="摄像头大小"
									value={value().config.camera.size}
									min={10}
									max={100}
									unit="%"
									change={(n) =>
										update((s) => {
											s.config.camera.size = n;
										})
									}
								/>
								<Range
									name="摄像头圆角"
									value={value().config.camera.rounding}
									max={100}
									change={(n) =>
										update((s) => {
											s.config.camera.rounding = n;
										})
									}
								/>
								<Check
									name="工程静音"
									value={value().config.audio.mute}
									change={(b) =>
										update((s) => {
											s.config.audio.mute = b;
										})
									}
								/>
								<Check
									name="声音增强"
									value={value().config.audio.improve}
									change={(b) =>
										update((s) => {
											s.config.audio.improve = b;
										})
									}
								/>
								<p class="jk-appearance-footnote">
									摄像头与声音选项作用于已选中的输入。设备录制和演示不叠加电脑摄像头。
								</p>
							</Show>
							<Show when={presets.query.data?.presets.length}>
								<label class="jk-control-row">
									<span>已有预设</span>
									<select
										aria-label="应用已有画面预设"
										value=""
										onChange={(e) => {
											const p =
												presets.query.data?.presets[
													Number(e.currentTarget.value)
												];
											if (p)
												update((s) => {
													s.config = structuredClone(unwrap(p.config));
													s.desktopWallpaper = false;
												});
										}}
									>
										<option value="" disabled>
											选择预设
										</option>
										<For each={presets.query.data?.presets}>
											{(p, i) => <option value={i()}>{p.name}</option>}
										</For>
									</select>
								</label>
							</Show>
						</fieldset>
						<div class="jk-appearance-state" role="status">
							<span>
								{error()
									? "保存失败"
									: saving()
										? "正在保存…"
										: "新捕获使用此设置"}
							</span>
							<span>录后仍可修改</span>
						</div>
						<Show when={error()}>
							<button
								type="button"
								class="jk-tonal-button"
								onClick={() => {
									if (!style()) {
										void load();
										return;
									}
									pending = style();
									props.onBusy(true);
									void save();
								}}
							>
								重试保存
							</button>
						</Show>
					</>
				)}
			</Show>
		</aside>
	);
}
