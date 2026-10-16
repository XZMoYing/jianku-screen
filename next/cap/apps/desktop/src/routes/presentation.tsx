import { listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open } from "@tauri-apps/plugin-dialog";
import {
	createEffect,
	createMemo,
	createResource,
	createSignal,
	For,
	on,
	onCleanup,
	Show,
} from "solid-js";
import toast from "solid-toast";
import {
	ASPECT_RATIO_OPTIONS,
	ASPECT_RATIOS,
} from "~/routes/editor/projectConfig";
import {
	type AspectRatio,
	type CaptureStyle,
	commands,
	type PresentationOptions,
	type PresentationStatus,
} from "~/utils/tauri";
import IconCheck from "~icons/lucide/check";
import IconChevronDown from "~icons/lucide/chevron-down";
import IconImage from "~icons/lucide/image";
import IconMonitor from "~icons/lucide/monitor";
import IconMousePointer2 from "~icons/lucide/mouse-pointer-2";
import IconPlay from "~icons/lucide/play";
import IconSlidersHorizontal from "~icons/lucide/sliders-horizontal";
import IconSquare from "~icons/lucide/square";
import IconSquareArrowOutUpRight from "~icons/lucide/square-arrow-out-up-right";

const backgrounds = [
	{ name: "暮紫", from: [95, 112, 237], to: [195, 148, 243], angle: 120 },
	{ name: "海盐", from: [98, 170, 203], to: [202, 231, 217], angle: 135 },
	{ name: "暖霞", from: [239, 159, 139], to: [246, 220, 175], angle: 120 },
	{ name: "夜色", from: [37, 44, 65], to: [90, 99, 126], angle: 135 },
] as const;

const focusModes = [
	{ id: "automatic", name: "自动", description: "按操作跟随" },
	{ id: "manual", name: "手动", description: "快捷键切换" },
	{ id: "off", name: "关闭", description: "保持完整画面" },
] as const;

export default function Presentation(props: {
	blocked?: boolean;
	captureStyle?: CaptureStyle;
	onStatus?: (status: PresentationStatus) => void;
	onBusy?: (busy: boolean) => void;
}) {
	const [setup, { refetch }] = createResource(() =>
		commands.getPresentationSetup(),
	);
	const [options, setOptions] = createSignal<PresentationOptions>();
	const [status, setStatus] = createSignal<PresentationStatus>();
	const [busy, setBusy] = createSignal(false);
	const [notice, setNotice] = createSignal("");
	let timer: ReturnType<typeof setTimeout> | undefined;
	let pending: PresentationOptions | undefined;
	let sending = false;
	let disposed = false;
	const report = (error: unknown) => {
		const message = error instanceof Error ? error.message : String(error);
		setNotice(message);
		toast.error(message);
	};
	createEffect(() => {
		const value = setup();
		if (value && !options()) setOptions(value.options);
	});
	const optionsReady = createMemo(() => !!options());
	createEffect(
		on([() => props.captureStyle, optionsReady], ([style, ready]) => {
			if (!style || !ready) return;
			const current = options();
			if (!current) return;
			update({
				...current,
				project: structuredClone(style.config),
				outputAspectRatio: style.config.aspectRatio,
			});
		}),
	);
	const setActivity = (value: boolean) => {
		setBusy(value);
		props.onBusy?.(value);
	};
	const acceptStatus = (value: PresentationStatus) => {
		if (disposed) return;
		setStatus(value);
		props.onStatus?.(value);
	};
	const refresh = async () =>
		acceptStatus(await commands.getPresentationStatus());
	void refresh().catch(report);
	const polling = setInterval(() => void refresh().catch(report), 1000);
	const changes = listen<PresentationOptions>(
		"presentation-options-changed",
		(event) => {
			if (pending) {
				pending = {
					...pending,
					outputWidth: event.payload.outputWidth,
					outputHeight: event.payload.outputHeight,
					focusMode: event.payload.focusMode,
					toggleEpoch: event.payload.toggleEpoch,
				};
				setOptions(pending);
			} else {
				setOptions(event.payload);
			}
		},
	);
	onCleanup(() => {
		disposed = true;
		clearInterval(polling);
		clearTimeout(timer);
		void changes.then((remove) => remove());
	});
	const flush = async () => {
		clearTimeout(timer);
		timer = undefined;
		while (sending && !disposed)
			await new Promise((resolve) => setTimeout(resolve, 16));
		if (disposed) return;
		sending = true;
		try {
			while (pending && !disposed) {
				const latest = pending;
				pending = undefined;
				const normalized = await commands.updatePresentation(latest);
				if (!pending) setOptions(normalized);
			}
		} catch (error) {
			report(error);
		} finally {
			sending = false;
		}
	};
	const update = (value: PresentationOptions) => {
		setOptions(value);
		pending = value;
		if (!timer && !sending)
			timer = setTimeout(() => void flush(), status()?.active ? 16 : 180);
	};
	const start = async () => {
		const value = options();
		if (!value || busy() || props.blocked) return;
		setActivity(true);
		setNotice("");
		try {
			await flush();
			acceptStatus(await commands.startPresentation(value));
		} catch (error) {
			report(error);
			await refresh();
		} finally {
			setActivity(false);
		}
	};
	const stop = async () => {
		setActivity(true);
		try {
			await flush();
			await commands.stopPresentation();
			await refresh();
		} catch (error) {
			report(error);
		} finally {
			setActivity(false);
		}
	};
	const adjustBackground = (
		key: "padding" | "rounding" | "inset" | "shadow" | "blur",
		value: number,
	) => {
		const current = options();
		if (!current) return;
		update({
			...current,
			project: {
				...current.project,
				background: { ...current.project.background, [key]: value },
			},
		});
	};
	const range = (
		label: string,
		value: number,
		max: number,
		onValue: (value: number) => void,
		min = 0,
		step = 1,
		unit = "",
	) => (
		<label class="studio-range">
			<span class="studio-range-label">
				<span>{label}</span>
				<span class="studio-range-value">
					{value.toFixed(step < 1 ? 1 : 0)}
					{unit}
				</span>
			</span>
			<input
				type="range"
				min={min}
				max={max}
				step={step}
				value={value}
				aria-label={label}
				onInput={(event) => onValue(Number(event.currentTarget.value))}
			/>
		</label>
	);
	const setBackground = (preset: (typeof backgrounds)[number]) => {
		const value = options();
		if (!value) return;
		update({
			...value,
			project: {
				...value.project,
				background: {
					...value.project.background,
					source: {
						type: "gradient",
						from: [...preset.from],
						to: [...preset.to],
						angle: preset.angle,
						noise_intensity: null,
						noise_scale: null,
						animated: null,
						animation_speed: null,
					},
				},
			},
		});
	};
	const chooseImage = async () => {
		const path = await open({
			multiple: false,
			filters: [
				{ name: "背景图片", extensions: ["png", "jpg", "jpeg", "webp"] },
			],
		});
		const value = options();
		if (path && value)
			update({
				...value,
				project: {
					...value.project,
					background: {
						...value.project.background,
						source: { type: "image", path },
					},
				},
			});
	};
	const showOutput = async () => {
		const window = await WebviewWindow.getByLabel("presentation-output");
		await window?.show();
		await window?.setFocus();
	};
	return (
		<div class="presentation-panel" data-testid="presentation-panel">
			<Show
				when={options()}
				fallback={
					<div class="studio-empty">
						{setup.error ? (
							<>
								<span>无法读取演示设置</span>
								<button
									type="button"
									class="studio-secondary"
									onClick={() => void refetch()}
								>
									重试
								</button>
							</>
						) : (
							"正在准备演示…"
						)}
					</div>
				}
			>
				{(value) => (
					<>
						<div class="presentation-scroll" data-testid="presentation-scroll">
							<div class="presentation-heading">
								<div>
									<h2>把操作变成一场演示</h2>
									<p>操作原屏幕，将平滑的画面输出给观众。</p>
								</div>
								<span
									class={`studio-status ${status()?.active ? "is-live" : ""}`}
								>
									<i />
									{status()?.active ? "正在演示" : "待机"}
								</span>
							</div>
							<div
								class="presentation-grid"
								classList={{ "jk-presentation-shared": !!props.captureStyle }}
							>
								<div class="presentation-primary">
									<section class="studio-card">
										<div class="studio-card-heading">
											<IconMonitor />
											<div>
												<h3>来源与输出</h3>
												<p>为观众选择一块独立的画布</p>
											</div>
										</div>
										<label class="studio-field">
											<span>演示来源</span>
											<div class="studio-select">
												<select
													aria-label="演示来源"
													disabled={busy() || status()?.active}
													value={value().sourceId}
													onChange={(event) =>
														update({
															...value(),
															sourceId: event.currentTarget.value,
														})
													}
												>
													<For each={setup()?.displays}>
														{(display) => (
															<option value={display.id}>{display.name}</option>
														)}
													</For>
												</select>
												<IconChevronDown />
											</div>
										</label>
										<label class="studio-field">
											<span>输出位置</span>
											<div class="studio-select">
												<select
													aria-label="输出位置"
													disabled={busy() || status()?.active}
													value={value().outputMonitor ?? "window"}
													onChange={(event) =>
														update({
															...value(),
															outputMonitor:
																event.currentTarget.value === "window"
																	? null
																	: Number(event.currentTarget.value),
														})
													}
												>
													<option value="window">共享窗口</option>
													<For each={setup()?.monitors}>
														{(monitor) => (
															<option value={monitor.index}>
																{monitor.name} · {monitor.width}×
																{monitor.height}
															</option>
														)}
													</For>
												</select>
												<IconChevronDown />
											</div>
											<small>
												{value().outputMonitor == null
													? "在会议软件中共享「简库演示输出」窗口。"
													: "输出铺满所选副屏，原屏幕保持原样。"}
											</small>
										</label>

										<label class="studio-field">
											<span>输出比例</span>
											<div class="studio-select">
												<select
													aria-label="输出比例"
													disabled={busy() || status()?.active}
													value={value().outputAspectRatio ?? "auto"}
													onChange={(event) =>
														update({
															...value(),
															outputAspectRatio:
																event.currentTarget.value === "auto"
																	? null
																	: (event.currentTarget.value as AspectRatio),
														})
													}
												>
													<For each={ASPECT_RATIO_OPTIONS}>
														{(aspect) => (
															<option value={aspect}>
																{aspect === "auto"
																	? "适合屏幕 · 默认"
																	: `${ASPECT_RATIOS[aspect].ratio[0]}:${ASPECT_RATIOS[aspect].ratio[1]} · ${ASPECT_RATIOS[aspect].name}`}
															</option>
														)}
													</For>
												</select>
												<IconChevronDown />
											</div>
											<small>
												{status()?.active
													? "停止演示后可更改比例。"
													: "适合屏幕按来源或副屏比例计算；固定比例保持画布形状。"}
											</small>
										</label>
										<label class="studio-field">
											<span>输出清晰度</span>
											<div class="studio-select">
												<select
													aria-label="输出清晰度"
													value={value().outputResolution}
													onChange={(event) =>
														update({
															...value(),
															outputResolution: Number(
																event.currentTarget.value,
															),
														})
													}
												>
													<option value={1280}>720p · 标准</option>
													<option value={1920}>1080p · 默认</option>
													<option value={2560}>1440p · 高清</option>
													<option value={3840}>2160p · 4K</option>
												</select>
												<IconChevronDown />
											</div>
											<small>
												{value().outputWidth} × {value().outputHeight} 像素
											</small>
										</label>
									</section>
									<section class="studio-card">
										<div class="studio-card-heading">
											<IconMousePointer2 />
											<div>
												<h3>焦点跟随</h3>
												<p>控制观众在什么时候看清细节</p>
											</div>
										</div>
										<div
											class="focus-mode-group"
											role="group"
											aria-label="焦点跟随方式"
										>
											<For each={focusModes}>
												{(mode) => (
													<button
														type="button"
														aria-pressed={value().focusMode === mode.id}
														class={
															value().focusMode === mode.id ? "is-selected" : ""
														}
														onClick={() =>
															update({ ...value(), focusMode: mode.id })
														}
													>
														<span>{mode.name}</span>
														<small>{mode.description}</small>
													</button>
												)}
											</For>
										</div>
										<p class="studio-hint">
											{value().focusMode === "automatic"
												? "点击、滚动或输入时放大，持续操作保持焦点，空闲后返回全景。"
												: value().focusMode === "manual"
													? "按下快捷键放大，再按一次返回全景。"
													: "保留完整画面，光标平滑与画面外观继续生效。"}
										</p>
										<Show when={value().focusMode !== "off"}>
											{range(
												"放大倍率",
												value().zoomAmount,
												4,
												(zoomAmount) => update({ ...value(), zoomAmount }),
												1,
												0.1,
												"×",
											)}
										</Show>
										<Show when={value().focusMode === "automatic"}>
											{range(
												"空闲后返回",
												value().idleSeconds,
												15,
												(idleSeconds) => update({ ...value(), idleSeconds }),
												1,
												0.5,
												" 秒",
											)}
										</Show>
										<label class="studio-field">
											<span>焦点快捷键</span>
											<input
												class="studio-shortcut"
												aria-label="焦点快捷键"
												value={value()
													.shortcut.replace("CommandOrControl", "⌘ / Ctrl")
													.replace("Super", "⌘")
													.replace("Control", "Ctrl")
													.replace("Shift", "⇧")
													.replace("Alt", "⌥")
													.replace("Space", "空格")}
												readOnly
												disabled={status()?.active || busy()}
												title="点击后按下组合键"
												onKeyDown={(event) => {
													event.preventDefault();
													if (
														["Shift", "Control", "Meta", "Alt"].includes(
															event.key,
														)
													)
														return;
													const modifiers = [
														event.metaKey ? "Super" : "",
														event.ctrlKey ? "Control" : "",
														event.altKey ? "Alt" : "",
														event.shiftKey ? "Shift" : "",
													].filter(Boolean);
													if (modifiers.length)
														update({
															...value(),
															shortcut: [...modifiers, event.code].join("+"),
														});
												}}
											/>
											<small>停止演示后可修改组合键。</small>
										</label>
										<Show
											when={status()?.active && value().focusMode === "manual"}
										>
											<button
												type="button"
												class="studio-secondary w-full"
												disabled={busy()}
												onClick={() =>
													void commands.togglePresentationFocus().catch(report)
												}
											>
												切换放大 / 缩小
											</button>
										</Show>
									</section>
								</div>
								<aside
									class="studio-card presentation-appearance"
									style={{ display: props.captureStyle ? "none" : undefined }}
								>
									<div class="studio-card-heading">
										<IconSlidersHorizontal />
										<div>
											<h3>画面外观</h3>
											<p>调整会即时应用到输出</p>
										</div>
									</div>
									<div
										class="background-swatches"
										role="group"
										aria-label="背景预设"
									>
										<For each={backgrounds}>
											{(preset) => {
												const selected = () => {
													const source = value().project.background.source;
													return (
														source.type === "gradient" &&
														source.from.every(
															(color, index) => color === preset.from[index],
														)
													);
												};
												return (
													<button
														type="button"
														aria-label={`背景：${preset.name}`}
														aria-pressed={selected()}
														title={preset.name}
														class={selected() ? "is-selected" : ""}
														style={{
															background: `linear-gradient(${preset.angle}deg, rgb(${preset.from.join(",")}), rgb(${preset.to.join(",")}))`,
														}}
														onClick={() => setBackground(preset)}
													>
														<Show when={selected()}>
															<IconCheck />
														</Show>
													</button>
												);
											}}
										</For>
									</div>
									<button
										type="button"
										class="studio-secondary w-full"
										onClick={() => void chooseImage().catch(report)}
									>
										<IconImage />
										{value().project.background.source.type === "image"
											? "更换背景图片"
											: "选择背景图片"}
									</button>
									<div class="studio-divider" />
									{range(
										"留白",
										value().project.background.padding,
										40,
										(value) => adjustBackground("padding", value),
									)}
									{range(
										"圆角",
										value().project.background.rounding,
										100,
										(value) => adjustBackground("rounding", value),
									)}
									{range(
										"内边距",
										value().project.background.inset,
										40,
										(value) => adjustBackground("inset", value),
									)}
									{range(
										"阴影",
										value().project.background.shadow,
										100,
										(value) => adjustBackground("shadow", value),
									)}
									{range(
										"背景模糊",
										value().project.background.blur,
										100,
										(value) => adjustBackground("blur", value),
									)}
									<div class="studio-divider" />
									{range(
										"光标大小",
										value().project.cursor.size,
										200,
										(size) =>
											update({
												...value(),
												project: {
													...value().project,
													cursor: { ...value().project.cursor, size },
												},
											}),
										50,
										1,
										"%",
									)}
								</aside>
							</div>
							<Show when={notice() || status()?.error}>
								<div class="studio-notice is-error" role="alert">
									{notice() || status()?.error}
								</div>
							</Show>
							<Show when={status()?.outputDetached}>
								<div class="studio-notice">
									副屏已断开，输出已回到共享窗口。
								</div>
							</Show>
							<Show when={!setup()?.supported}>
								<div class="studio-notice">当前平台暂不支持实时演示。</div>
							</Show>
						</div>
						<footer
							class="presentation-footer"
							data-testid="presentation-footer"
						>
							<div class="presentation-footer-caption">
								<span
									class={`studio-status ${status()?.active ? "is-live" : ""}`}
								>
									<i />
									{busy()
										? "正在处理…"
										: status()?.active
											? "输出已开启"
											: "准备开始"}
								</span>
								<small>
									{status()?.active
										? "设置会实时应用，源屏幕不受影响"
										: "开始后生成独立的演示输出窗口"}
								</small>
							</div>
							<div class="presentation-footer-actions">
								<Show when={status()?.active}>
									<button
										type="button"
										class="studio-secondary"
										onClick={() => void showOutput().catch(report)}
									>
										<IconSquareArrowOutUpRight />
										查看输出
									</button>
								</Show>
								<button
									type="button"
									class={`studio-primary ${status()?.active ? "is-stop" : ""}`}
									disabled={busy() || !setup()?.supported || props.blocked}
									onClick={() => void (status()?.active ? stop() : start())}
								>
									<Show when={status()?.active} fallback={<IconPlay />}>
										<IconSquare />
									</Show>
									{status()?.active ? "停止演示" : "开始演示"}
								</button>
							</div>
						</footer>
					</>
				)}
			</Show>
		</div>
	);
}
