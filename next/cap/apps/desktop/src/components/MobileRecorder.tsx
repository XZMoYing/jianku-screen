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
import { commands, type MobileStatus } from "~/utils/tauri";
import IconRefresh from "~icons/lucide/refresh-cw";
import IconSmartphone from "~icons/lucide/smartphone";
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
			toast.success("工程已恢复，原始视频已保留");
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
			<div class="mobile-heading">
				<span class="mobile-symbol">
					<IconSmartphone />
				</span>
				<div>
					<h2>录制移动设备</h2>
					<p>用 USB 连接手机或平板，录完继续编辑镜头与画面。</p>
				</div>
			</div>
			<div class="mobile-device-card">
				<div class="flex items-center justify-between gap-3">
					<label for="mobile-device">录制设备</label>
					<button
						type="button"
						class="studio-secondary"
						disabled={busy() || status()?.active || setup.loading}
						onClick={() => void refetch()}
					>
						<IconRefresh class="size-3.5" />
						{setup.loading ? "正在查找…" : "刷新设备"}
					</button>
				</div>
				<select
					id="mobile-device"
					value={selection()}
					disabled={busy() || status()?.active}
					onChange={(event) => setSelection(event.currentTarget.value)}
				>
					<option value="">
						{setup.loading ? "正在查找 USB 设备…" : "请选择已连接的设备"}
					</option>
					<For each={setup()?.devices}>
						{(device) => (
							<option
								value={`${device.platform}:${device.id}`}
								disabled={!device.authorized}
							>
								{device.name} ·{" "}
								{device.platform === "ios" ? "iOS / iPadOS" : "安卓"}
								{device.authorized ? "" : " · 请允许 USB 调试"}
							</option>
						)}
					</For>
				</select>
				<Show when={selected()?.mi6Compatibility}>
					<p class="mobile-hint">
						已识别 MI 6，使用专用连接兼容；手机应用与网络设置保持运行。
					</p>
				</Show>
				<label class="mobile-toggle">
					<span>
						<strong>设备声音</strong>
						<small>
							{selected()?.audioSupported
								? "录制设备播放的声音"
								: "安卓声音录制需 Android 11 或更新版本；应用也可限制录音。"}
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
						<strong>打开设备预览</strong>
						<small>在独立窗口查看画面；安卓设备也支持鼠标操作。</small>
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
						{busy() ? "正在连接…" : "开始设备录制"}
					</button>
				}
			>
				<div class="mobile-record-status" role="status">
					<span class="mobile-record-dot" />
					{status()?.phase === "starting"
						? "正在连接设备…"
						: status()?.phase === "finalizing"
							? "正在保存工程…"
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
						? "正在保存…"
						: "停止并打开编辑器"}
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
						继续编辑设备录制
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
						? "查看保留的原始文件"
						: "查看工程保存位置"}
				</button>
			</Show>
			<section class="mobile-history" data-testid="mobile-history">
				<div class="mobile-history-heading">
					<h3>最近设备录制</h3>
					<button
						type="button"
						class="studio-secondary"
						disabled={projects.loading || busy()}
						onClick={() => void refreshProjects()}
					>
						<IconRefresh class="size-3.5" />
						刷新列表
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
								? "正在读取录制…"
								: "设备录制会保存在这里，重启后也能继续编辑。"}
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
											? "已保存"
											: project.phase === "recording"
												? "录制或保存中"
												: project.hasSource
													? "待恢复 · 原始视频已保留"
													: "原始视频缺失"}
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
										{project.phase === "complete" ? "继续编辑" : "恢复并编辑"}
									</button>
									<button
										type="button"
										class="mobile-project-location"
										onClick={() => reveal(project.path)}
									>
										定位
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
							? "收起列表"
							: `显示全部 ${projects()?.length} 条设备录制`}
					</button>
				</Show>
			</section>
			<div class="mobile-connection-guide">
				<p>
					<strong>iPhone / iPad</strong>连接
					USB，解锁设备，在设备上选择「信任」。
				</p>
				<p>
					<strong>安卓</strong>开启「开发者选项 → USB 调试」，连接后允许这台
					Mac。
				</p>
				<p>
					录后按画幅初选手机或平板外框，可在编辑器中切换或关闭。支持缩放、运镜、动态模糊和画面设置。
					当前不支持自动跟随设备触摸，可手动添加镜头。
				</p>
			</div>
		</div>
	);
}
