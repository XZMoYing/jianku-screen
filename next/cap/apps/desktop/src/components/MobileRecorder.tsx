import { makePersisted } from "@solid-primitives/storage";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
	createEffect,
	createMemo,
	createResource,
	createSignal,
	For,
	onCleanup,
	Show,
} from "solid-js";
import toast from "solid-toast";
import { t as localize } from "~/utils/i18n";
import {
	mobileCaptureDefaults,
	mobileOrientationOptions,
	mobileSizeOptions,
	parseMobileCaptureSettings,
} from "~/utils/mobile-capture-settings";
import {
	commands,
	type MobileCaptureSettings,
	type MobileStatus,
} from "~/utils/tauri";
import IconRefresh from "~icons/lucide/refresh-cw";
import IconSquare from "~icons/lucide/square";

export default function MobileRecorder(props: {
	visible: boolean;
	blocked: boolean;
	onActive: (active: boolean) => void;
}) {
	const [setup, { refetch }] = createResource(
		() => props.visible,
		() => commands.getMobileSetup(),
	);
	const [selection, setSelection] = createSignal("");
	const [audio, setAudio] = createSignal(true);
	const [preview, setPreview] = createSignal(true);
	const [captureSettings, setCaptureSettings] = makePersisted(
		createSignal<MobileCaptureSettings>({ ...mobileCaptureDefaults }),
		{
			name: "jianku.mobile.captureSettings",
			deserialize: parseMobileCaptureSettings,
		},
	);
	const [status, setStatus] = createSignal<MobileStatus>();
	const [busy, setBusy] = createSignal(false);
	const [error, setError] = createSignal("");
	const [allProjects, setAllProjects] = createSignal(false);
	const historyKey = createMemo(() =>
		props.visible
			? `${status()?.phase ?? "idle"}:${status()?.projectPath ?? ""}`
			: false,
	);
	const [projects, { refetch: refreshProjects }] = createResource(
		historyKey,
		() => commands.listMobileProjects(),
	);
	const visibleProjects = createMemo(() =>
		allProjects() ? projects() : projects()?.slice(0, 8),
	);
	let disposed = false;
	let polling = false;
	const selected = createMemo(() =>
		setup()?.devices.find(
			(device) => `${device.platform}:${device.id}` === selection(),
		),
	);
	createEffect(() => {
		const value = setup();
		if (
			value &&
			!value.devices.some(
				(device) => `${device.platform}:${device.id}` === selection(),
			)
		) {
			const device = value.devices.find((device) => device.authorized);
			setSelection(device ? `${device.platform}:${device.id}` : "");
		}
	});
	const accept = (value: MobileStatus) => {
		if (disposed) return;
		setStatus(value);
		props.onActive(value.active);
	};
	const refresh = async () => {
		if (polling || disposed) return;
		polling = true;
		try {
			accept(await commands.getMobileStatus());
		} catch (error) {
			if (!disposed) setError(String(error));
		} finally {
			polling = false;
		}
	};
	void refresh();
	const timer = setInterval(() => void refresh(), 500);
	onCleanup(() => {
		disposed = true;
		clearInterval(timer);
	});
	const record = async () => {
		const device = selected();
		if (!device || busy() || status()?.active) return;
		setBusy(true);
		setError("");
		try {
			accept(
				await commands.startMobileRecording({
					deviceId: device.id,
					platform: device.platform,
					audio: audio() && device.audioSupported,
					preview: preview(),
					capture: captureSettings(),
				}),
			);
		} catch (error) {
			setError(String(error));
			toast.error(String(error));
		} finally {
			setBusy(false);
		}
	};
	const stop = async () => {
		if (busy()) return;
		setBusy(true);
		setError("");
		try {
			await commands.stopMobileRecording();
			await refresh();
		} catch (error) {
			setError(String(error));
			toast.error(String(error));
		} finally {
			setBusy(false);
		}
	};
	const recover = async (path: string) => {
		if (busy() || status()?.active || props.blocked) return;
		setBusy(true);
		setError("");
		try {
			await commands.recoverMobileProject(path);
			await refresh();
			await refreshProjects();
			toast.success(localize("工程已恢复，原始视频已保留"));
		} catch (error) {
			setError(String(error));
			toast.error(String(error));
		} finally {
			setBusy(false);
		}
	};
	const reveal = (path: string) =>
		void revealItemInDir(path).catch((error) => toast.error(String(error)));
	const time = () => {
		const seconds = Math.floor(status()?.elapsedSeconds ?? 0);
		return `${Math.floor(seconds / 60)
			.toString()
			.padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
	};
	return (
		<div
			class="mobile-recorder"
			style={{ display: props.visible ? "flex" : "none" }}
			data-testid="mobile-recorder"
		>
			<div class="mobile-device-card">
				<div class="flex items-center justify-between gap-3">
					<label for="mobile-device">{localize("录制设备")}</label>
					<button
						type="button"
						class="studio-secondary"
						disabled={busy() || status()?.active || setup.loading}
						onClick={() => void refetch()}
					>
						<IconRefresh class="size-3.5" />
						{setup.loading ? localize("正在查找…") : localize("刷新设备")}
					</button>
				</div>
				<select
					id="mobile-device"
					value={selection()}
					disabled={busy() || status()?.active}
					onChange={(event) => setSelection(event.currentTarget.value)}
				>
					<option value="">
						{setup.loading
							? localize("正在查找 USB 设备…")
							: localize("请选择已连接的设备")}
					</option>
					<For each={setup()?.devices}>
						{(device) => (
							<option
								value={`${device.platform}:${device.id}`}
								disabled={!device.authorized}
							>
								{device.name} ·{" "}
								{device.platform === "ios" ? "iOS / iPadOS" : localize("安卓")}
				{device.authorized ? "" : ` · ${localize("请允许 USB 调试")}`}
							</option>
						)}
					</For>
				</select>
				<Show when={selected()?.mi6Compatibility}>
					<p class="mobile-hint">
						{localize("已识别 MI 6，使用专用连接兼容；手机应用与网络设置保持运行。")}
					</p>
				</Show>
				<Show when={selected()?.platform === "android"}>
					<div
						class="mobile-capture-settings"
						data-testid="mobile-capture-settings"
					>
						<label>
							<span>{localize("录制尺寸")}</span>
							<select
								aria-label={localize("设备录制尺寸")}
								value={captureSettings().maxSize}
								disabled={status()?.active || busy()}
								onChange={(event) =>
									setCaptureSettings((settings) => ({
										...settings,
										maxSize: Number(event.currentTarget.value),
									}))
								}
							>
								<For each={mobileSizeOptions}>
									{(option) => (
										<option
											value={option.value}
											selected={captureSettings().maxSize === option.value}
										>
											{option.label}
										</option>
									)}
								</For>
							</select>
						</label>
						<label>
							<span>{localize("帧率上限")}</span>
							<select
								aria-label={localize("设备录制帧率")}
								value={captureSettings().maxFps}
								disabled={status()?.active || busy()}
								onChange={(event) =>
									setCaptureSettings((settings) => ({
										...settings,
										maxFps: Number(event.currentTarget.value),
									}))
								}
							>
								<option value={30}>{localize("最高 30 fps")}</option>
								<option value={60}>{localize("最高 60 fps")}</option>
							</select>
						</label>
						<label>
							<span>{localize("编码画质")}</span>
							<select
								aria-label={localize("设备录制画质")}
								value={captureSettings().bitRateMbps}
								disabled={status()?.active || busy()}
								onChange={(event) =>
									setCaptureSettings((settings) => ({
										...settings,
										bitRateMbps: Number(event.currentTarget.value),
									}))
								}
							>
								<option value={8}>{localize("标准 · 8 Mbps")}</option>
								<option value={16}>{localize("高画质 · 16 Mbps")}</option>
								<option value={32}>{localize("更高画质 · 32 Mbps")}</option>
							</select>
						</label>
						<label>
							<span>{localize("画面方向")}</span>
							<select
								aria-label={localize("设备录制方向")}
								value={captureSettings().orientation}
								disabled={status()?.active || busy()}
								onChange={(event) => {
									const orientation = mobileOrientationOptions.find(
										(option) => option.value === event.currentTarget.value,
									)?.value;
									if (orientation)
										setCaptureSettings((settings) => ({
											...settings,
											orientation,
										}));
								}}
							>
								<For each={mobileOrientationOptions}>
									{(option) => (
										<option
											value={option.value}
											selected={captureSettings().orientation === option.value}
										>
											{option.label}
										</option>
									)}
								</For>
							</select>
						</label>
					</div>
					<p class="mobile-capture-note">
					{localize("按设备比例录制，不放大低分辨率来源。实际帧率由设备与画面变化决定。")}
					</p>
					<p class="mobile-capture-note">
					{localize("画面方向在录制期间保持不变，设备仍可正常旋转。需要换画幅时，可停止后重新开始。")}
					</p>
				</Show>
				<label class="mobile-toggle">
					<span>
						<strong>{localize("设备声音")}</strong>
						<small>
							{selected()?.audioSupported
							? localize("录制设备播放的声音")
								: selected()?.platform === "ios"
									? localize("这台设备暂未提供可录制的声音。")
									: localize("安卓声音录制需 Android 11 或更新版本；应用也可限制录音。")}
						</small>
					</span>
					<input
						type="checkbox"
						checked={audio() && !!selected()?.audioSupported}
						disabled={!selected()?.audioSupported || status()?.active || busy()}
						onChange={(event) => setAudio(event.currentTarget.checked)}
					/>
				</label>
				<label class="mobile-toggle">
					<span>
						<strong>{localize("打开设备预览")}</strong>
						<small>
							{localize("在独立窗口查看画面；安卓设备也支持鼠标操作。")}
						</small>
					</span>
					<input
						type="checkbox"
						checked={preview()}
						disabled={status()?.active || busy()}
						onChange={(event) => setPreview(event.currentTarget.checked)}
					/>
				</label>
			</div>
			<Show
				when={status()?.active}
				fallback={
					<button
						type="button"
						class="mobile-record-button"
						disabled={
							!selected()?.authorized ||
							busy() ||
							props.blocked ||
							(selected()?.platform === "android" && !setup()?.androidReady) ||
							(selected()?.platform === "ios" && !setup()?.iosReady)
						}
						onClick={() => void record()}
					>
						{busy() ? localize("正在连接…") : localize("开始设备录制")}
					</button>
				}
			>
				<div class="mobile-record-status" role="status">
					<span class="mobile-record-dot" />
					{status()?.phase === "starting"
						? localize("正在连接设备…")
						: status()?.phase === "finalizing"
							? localize("正在保存工程…")
							: `${status()?.deviceName} · ${time()}`}
				</div>
				<button
					type="button"
					class="mobile-record-button is-stopping"
					disabled={busy() || status()?.phase === "finalizing"}
					onClick={() => void stop()}
				>
					<IconSquare class="size-4" />
					{busy() || status()?.phase === "finalizing"
						? localize("正在保存…")
						: localize("停止并打开编辑器")}
				</button>
			</Show>
			<Show when={error() || status()?.error || setup.error}>
				<p class="mobile-error" role="alert">
					{error() || status()?.error || String(setup.error)}
				</p>
			</Show>
			<Show when={status()?.notice}>
				<p class="mobile-hint" role="status">
					{status()?.notice}
				</p>
			</Show>
			<For each={setup()?.warnings}>
				{(warning) => <p class="mobile-hint">{warning}</p>}
			</For>
			<Show when={status()?.phase === "complete" && status()?.projectPath}>
				{(path) => (
					<button
						type="button"
						class="studio-secondary"
						disabled={busy() || props.blocked}
						onClick={() =>
							void commands
								.openLocalProject(path())
								.catch((error) => toast.error(String(error)))
						}
					>
						{localize("继续编辑设备录制")}
					</button>
				)}
			</Show>
			<Show when={status()?.projectPath}>
				<button
					type="button"
					class="mobile-project-location"
					onClick={() => {
						const path = status()?.projectPath;
						if (path) reveal(path);
					}}
				>
					{status()?.phase === "failed"
						? localize("查看保留的原始文件")
						: localize("查看工程保存位置")}
				</button>
			</Show>
			<section class="mobile-history" data-testid="mobile-history">
				<div class="mobile-history-heading">
					<h3>{localize("最近设备录制")}</h3>
					<button
						type="button"
						class="studio-secondary"
						disabled={projects.loading || busy()}
						onClick={() => void refreshProjects()}
					>
						<IconRefresh class="size-3.5" />
						{localize("刷新列表")}
					</button>
				</div>
				<Show when={projects.error}>
					<p class="mobile-error">{String(projects.error)}</p>
				</Show>
				<Show
					when={projects()?.length}
					fallback={
						<p class="mobile-history-empty">
							{projects.loading
							? localize("正在读取录制…")
							: localize("设备录制会保存在这里，重启后也能继续编辑。")}
						</p>
					}
				>
					<For each={visibleProjects()}>
						{(project) => (
							<div class="mobile-history-row" data-project-path={project.path}>
								<div class="mobile-history-name">
									<strong title={project.name}>{project.name}</strong>
									<small>
										{project.phase === "complete"
											? localize("已保存")
											: project.phase === "recording"
								? localize("录制或保存中")
												: project.hasSource
									? localize("待恢复 · 原始视频已保留")
									: localize("原始视频缺失")}
									</small>
								</div>
								<div class="mobile-history-actions">
									<button
										type="button"
										class="studio-secondary"
										disabled={
											busy() ||
											props.blocked ||
											status()?.active ||
											project.phase === "recording" ||
											!project.hasSource
										}
										onClick={() => {
											if (project.phase === "complete") {
												void commands
													.openLocalProject(project.path)
													.catch((error) => toast.error(String(error)));
											} else {
												void recover(project.path);
											}
										}}
									>
						{project.phase === "complete"
							? localize("继续编辑")
							: localize("恢复并编辑")}
									</button>
									<button
										type="button"
										class="mobile-project-location"
										onClick={() => reveal(project.path)}
									>
										{localize("定位")}
									</button>
								</div>
							</div>
						)}
					</For>
				</Show>
				<Show when={(projects()?.length ?? 0) > 8}>
					<button
						type="button"
						class="mobile-project-location mt-4"
						onClick={() => setAllProjects(!allProjects())}
					>
						{allProjects()
							? localize("收起列表")
							: localize("显示全部 {count} 条设备录制", {
									count: projects()?.length ?? 0,
								})}
					</button>
				</Show>
			</section>
			<div class="mobile-connection-guide">
				<p>
					<strong>iPhone / iPad</strong>
					{localize("连接 USB，解锁设备，在设备上选择「信任」。")}
				</p>
				<p>
					<strong>{localize("安卓")}</strong>
					{localize("开启「开发者选项 → USB 调试」，连接后允许这台 Mac。")}
				</p>
				<p>
					{localize("录制后可先按画幅选择手机或平板外框；可在编辑器中切换或关闭。支持缩放、运镜、动态模糊和画面设置。暂不支持自动跟随设备触摸，可手动添加镜头。")}
				</p>
			</div>
		</div>
	);
}
