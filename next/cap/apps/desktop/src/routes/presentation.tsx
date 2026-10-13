import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
	createEffect,
	createResource,
	createSignal,
	For,
	onCleanup,
	Show,
} from "solid-js";
import toast from "solid-toast";
import {
	commands,
	type PresentationOptions,
	type PresentationStatus,
} from "~/utils/tauri";

export default function Presentation() {
	const [setup] = createResource(() => commands.getPresentationSetup());
	const [options, setOptions] = createSignal<PresentationOptions>();
	const [status, setStatus] = createSignal<PresentationStatus>();
	const [busy, setBusy] = createSignal(false);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let disposed = false;
	createEffect(() => {
		const value = setup();
		if (value && !options()) setOptions(value.options);
	});
	const report = (error: unknown) =>
		toast.error(error instanceof Error ? error.message : String(error));
	const refresh = async () => {
		const value = await commands.getPresentationStatus();
		if (!disposed) setStatus(value);
	};
	const polling = setInterval(() => void refresh().catch(report), 1000);
	const changes = listen<PresentationOptions>(
		"presentation-options-changed",
		(event) => setOptions(event.payload),
	);
	onCleanup(() => {
		disposed = true;
		clearInterval(polling);
		clearTimeout(timer);
		void changes.then((remove) => remove());
	});
	const update = (value: PresentationOptions) => {
		setOptions(value);
		if (status()?.active && !timer)
			timer = setTimeout(() => {
				timer = undefined;
				const latest = options();
				if (latest) void commands.updatePresentation(latest).catch(report);
			}, 16);
	};
	const start = async () => {
		const value = options();
		if (!value || busy()) return;
		setBusy(true);
		try {
			setStatus(await commands.startPresentation(value));
		} catch (error) {
			report(error);
			await refresh();
		} finally {
			setBusy(false);
		}
	};
	const stop = async () => {
		setBusy(true);
		try {
			await commands.stopPresentation();
			await refresh();
		} catch (error) {
			report(error);
		} finally {
			setBusy(false);
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
	) => (
		<label class="grid grid-cols-[105px_1fr_45px] gap-3 items-center text-sm">
			<span>{label}</span>
			<input
				class="w-full accent-violet-500"
				type="range"
				min={min}
				max={max}
				step={step}
				value={value}
				onInput={(event) => onValue(Number(event.currentTarget.value))}
			/>
			<span class="text-right tabular-nums text-gray-10">
				{value.toFixed(step < 1 ? 1 : 0)}
			</span>
		</label>
	);
	const inputClass =
		"bg-gray-3 border border-gray-6 rounded-lg px-3 py-2 w-full text-sm disabled:opacity-50";
	return (
		<main class="min-h-screen p-5 bg-gray-1 text-gray-12 space-y-5">
			<header>
				<h1 class="text-xl font-medium">实时演示</h1>
				<p class="mt-1 text-sm text-gray-10">
					操作原屏幕，观众看到平滑的演示画面。
				</p>
			</header>
			<Show when={options()} fallback={<p>正在准备…</p>}>
				{(value) => (
					<>
						<section class="rounded-xl border border-gray-5 p-4 space-y-3">
							<label class="block text-sm">
								演示来源
								<select
									class={`${inputClass} mt-1`}
									disabled={busy() || status()?.active}
									value={value().sourceId}
									onChange={(event) =>
										update({ ...value(), sourceId: event.currentTarget.value })
									}
								>
									<For each={setup()?.displays}>
										{(display) => (
											<option value={display.id}>{display.name}</option>
										)}
									</For>
								</select>
							</label>
							<label class="block text-sm">
								输出位置
								<select
									class={`${inputClass} mt-1`}
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
									<option value="window">
										共享窗口 · 会议中选择“简库演示输出”
									</option>
									<For each={setup()?.monitors}>
										{(monitor) => (
											<option value={monitor.index}>
												{monitor.name} · {monitor.width}×{monitor.height}
											</option>
										)}
									</For>
								</select>
							</label>
							<label class="block text-sm">
								输出清晰度
								<select
									class={`${inputClass} mt-1`}
									value={value().outputWidth}
									onChange={(event) =>
										update({
											...value(),
											outputWidth: Number(event.currentTarget.value),
											outputHeight:
												Math.round(
													(Number(event.currentTarget.value) * 9) / 16 / 2,
												) * 2,
										})
									}
								>
									<option value={1920}>1920 · 默认</option>
									<option value={2560}>2560 · 更清晰</option>
									<option value={3840}>3840 · 4K</option>
								</select>
							</label>
						</section>
						<section class="rounded-xl border border-gray-5 p-4 space-y-3">
							<div class="flex gap-2">
								<For
									each={
										[
											{ id: "automatic", name: "自动焦点" },
											{ id: "manual", name: "手动焦点" },
											{ id: "off", name: "关闭缩放" },
										] as const
									}
								>
									{(mode) => (
										<button
											type="button"
											class={`flex-1 rounded-lg px-2 py-2 text-sm ${value().focusMode === mode.id ? "bg-violet-9 text-white" : "bg-gray-3"}`}
											onClick={() => update({ ...value(), focusMode: mode.id })}
										>
											{mode.name}
										</button>
									)}
								</For>
							</div>
							<p class="text-xs text-gray-10">
								自动模式在点击、滚动和输入时放大，持续操作会保持焦点，空闲后缩小。手动模式再次按快捷键切换放大或缩小。
							</p>
							{range(
								"放大倍率",
								value().zoomAmount,
								4,
								(zoomAmount) => update({ ...value(), zoomAmount }),
								1,
								0.1,
							)}
							{range(
								"空闲后缩小",
								value().idleSeconds,
								15,
								(idleSeconds) => update({ ...value(), idleSeconds }),
								1,
								0.5,
							)}
							<label class="block text-sm">
								焦点快捷键
								<input
									class={`${inputClass} mt-1`}
									value={value()
										.shortcut.replace("CommandOrControl", "⌘ / Ctrl")
										.replace("Super", "⌘")
										.replace("Control", "Ctrl")
										.replace("Shift", "⇧")
										.replace("Alt", "⌥")
										.replace("Space", "空格")}
									readOnly
									onKeyDown={(event) => {
										event.preventDefault();
										if (["Shift", "Control", "Meta", "Alt"].includes(event.key))
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
									title="点击后按下你想使用的组合键"
									disabled={status()?.active || busy()}
									onChange={(event) =>
										update({ ...value(), shortcut: event.currentTarget.value })
									}
								/>
							</label>
							<button
								type="button"
								class="w-full px-3 py-2 text-sm rounded-lg bg-gray-3 disabled:opacity-50"
								disabled={!status()?.active || busy()}
								onClick={() =>
									void commands.togglePresentationFocus().catch(report)
								}
							>
								切换放大 / 缩小
							</button>
						</section>
						<section class="rounded-xl border border-gray-5 p-4 space-y-3">
							<h2 class="text-sm font-medium">画面外观</h2>
							{range("留白", value().project.background.padding, 40, (value) =>
								adjustBackground("padding", value),
							)}
							{range(
								"圆角",
								value().project.background.rounding,
								100,
								(value) => adjustBackground("rounding", value),
							)}
							{range("内边距", value().project.background.inset, 40, (value) =>
								adjustBackground("inset", value),
							)}
							{range("阴影", value().project.background.shadow, 100, (value) =>
								adjustBackground("shadow", value),
							)}
							{range(
								"背景模糊",
								value().project.background.blur,
								100,
								(value) => adjustBackground("blur", value),
							)}
							<div class="flex gap-2">
								<button
									type="button"
									class="bg-gray-3 rounded-lg px-3 py-2 text-sm"
									onClick={() =>
										update({
											...value(),
											project: {
												...value().project,
												background: {
													...value().project.background,
													source: {
														type: "gradient",
														from: [95, 112, 237],
														to: [195, 148, 243],
														angle: 120,
														noise_intensity: null,
														noise_scale: null,
														animated: null,
														animation_speed: null,
													},
												},
											},
										})
									}
								>
									柔和渐变
								</button>
								<button
									type="button"
									class="bg-gray-3 rounded-lg px-3 py-2 text-sm"
									onClick={() =>
										void open({
											multiple: false,
											filters: [
												{
													name: "背景图片",
													extensions: ["png", "jpg", "jpeg", "webp"],
												},
											],
										})
											.then((path) => {
												if (path)
													update({
														...value(),
														project: {
															...value().project,
															background: {
																...value().project.background,
																source: { type: "image", path },
															},
														},
													});
											})
											.catch(report)
									}
								>
									选择背景图
								</button>
							</div>
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
							)}
						</section>
						<Show when={status()?.error}>
							<p class="text-sm text-red-11">{status()?.error}</p>
						</Show>
						<Show when={status()?.outputDetached}>
							<p class="text-sm text-gray-10">
								副屏已断开，输出已回到共享窗口。
							</p>
						</Show>
						<div class="sticky bottom-0 bg-gray-1 py-3 flex items-center justify-between gap-3">
							<span class="text-sm text-gray-10">
								{busy()
									? "正在处理…"
									: status()?.active
										? "演示进行中"
										: "准备就绪"}
							</span>
							<button
								type="button"
								disabled={busy() || !setup()?.supported}
								class="rounded-lg bg-violet-9 px-5 py-2 text-white disabled:opacity-50"
								onClick={() => void (status()?.active ? stop() : start())}
							>
								{status()?.active ? "停止演示" : "开始演示"}
							</button>
						</div>
					</>
				)}
			</Show>
		</main>
	);
}
