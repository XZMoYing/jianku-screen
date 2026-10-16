import { convertFileSrc } from "@tauri-apps/api/core";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { unwrap } from "solid-js/store";
import toast from "solid-toast";
import { FrameOptions } from "~/routes/editor/FrameButton";
import { generalSettingsStore } from "~/store";
import { createPresets } from "~/utils/createPresets";
import { t as localize } from "~/utils/i18n";
import {
	type BackgroundSource,
	type CaptureStyle,
	commands,
} from "~/utils/tauri";
import { BackgroundSettings } from "./BackgroundSettings";
import { CameraSettings } from "./CameraSettings";
import { CursorSettings } from "./CursorSettings";
import { MotionGroup, MotionSwitch } from "./InterfaceMotion";
import { LayoutSettings } from "./LayoutSettings";

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
	return (
		<aside
			class="jk-appearance"
			aria-label={localize("捕获前画面设置")}
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
						<fieldset class="jk-appearance-controls" disabled={props.blocked}>
							<MotionGroup
								class="jk-appearance-tabs"
								label={localize("画面设置分组")}
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
							</MotionGroup>
							<MotionSwitch value={tab()}>
								{(panel) => (
									<>
										<Show when={panel() === "background"}>
											<BackgroundSettings
												background={value().config.background}
												desktopSelected={value().desktopWallpaper}
												onChange={(patch, desktop) =>
													update((s) => {
														Object.assign(s.config.background, patch);
														if (patch.source)
															s.desktopWallpaper = desktop ?? false;
													})
												}
											/>
										</Show>
										<Show when={panel() === "layout"}>
											<LayoutSettings
												background={value().config.background}
												aspectRatio={value().config.aspectRatio}
												onAspectRatio={(ratio) =>
													update((s) => {
														s.config.aspectRatio = ratio;
													})
												}
												onChange={(patch) =>
													update((s) =>
														Object.assign(s.config.background, patch),
													)
												}
												motionBlur={
													value().config.screenMotionBlur ??
													value().config.cursor.motionBlur ??
													1
												}
												onMotionBlur={(amount) =>
													update((s) => {
														s.config.screenMotionBlur = amount;
													})
												}
											/>
											<details class="jk-appearance-details">
												<summary>{localize("画面外框")}</summary>
												<FrameOptions
													frame={value().config.background.frame}
													onChange={(frame) =>
														update((s) => {
															s.config.background.frame = frame;
														})
													}
												/>
											</details>
										</Show>
										<Show when={panel() === "cursor"}>
											<CursorSettings
												cursor={value().config.cursor}
												onChange={(patch) =>
													update((s) => Object.assign(s.config.cursor, patch))
												}
											/>
											<Range
												name={localize("画面动态模糊")}
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
										<Show when={panel() === "camera"}>
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
												name={localize("默认放大倍率")}
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
											<CameraSettings
												camera={value().config.camera}
												onChange={(patch) =>
													update((s) => Object.assign(s.config.camera, patch))
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
												name={localize("声音增强")}
												value={value().config.audio.improve}
												change={(b) =>
													update((s) => {
														s.config.audio.improve = b;
													})
												}
											/>
											<p class="jk-appearance-footnote">
												{localize(
													"摄像头与声音选项作用于已选中的输入。设备录制和演示不叠加电脑摄像头。",
												)}
											</p>
										</Show>
										<Show when={presets.query.data?.presets.length}>
											<label class="jk-control-row">
												<span>{localize("已有预设")}</span>
												<select
													aria-label={localize("应用已有画面预设")}
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
														{localize("选择预设")}
													</option>
													<For each={presets.query.data?.presets}>
														{(p, i) => <option value={i()}>{p.name}</option>}
													</For>
												</select>
											</label>
										</Show>
									</>
								)}
							</MotionSwitch>
						</fieldset>
						<div class="jk-appearance-state" role="status">
							<span>
								{error()
									? "保存失败"
									: saving()
										? "正在保存…"
										: "新捕获使用此设置"}
							</span>
							<span>{localize("录后仍可修改")}</span>
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
								{localize("重试保存")}
							</button>
						</Show>
					</>
				)}
			</Show>
		</aside>
	);
}
