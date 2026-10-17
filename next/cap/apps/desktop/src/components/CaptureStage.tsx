import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { ASPECT_RATIOS } from "~/routes/editor/projectConfig";
import FrameWorker from "~/utils/frame-worker?worker";
import { t as localize } from "~/utils/i18n";
import { type CaptureStyle, commands } from "~/utils/tauri";

export default function CaptureStage(props: {
	style: CaptureStyle | undefined;
	cameraEnabled: boolean;
}) {
	let canvas!: HTMLCanvasElement;
	const [playing, setPlaying] = createSignal(false);
	const [error, setError] = createSignal("");
	const [ready, setReady] = createSignal(false);
	const [connected, setConnected] = createSignal(false);
	const [visible, setVisible] = createSignal(
		document.visibilityState === "visible",
	);
	const ratio = () => props.style?.config.aspectRatio;
	let disposed = false;
	let starting = false;
	let socket: WebSocket | undefined;
	let worker: Worker | undefined;
	let pending: ArrayBuffer | undefined;
	let available = false;
	const config = () => {
		if (!props.style) return;
		const value = structuredClone(props.style.config);
		value.camera.hide = !props.cameraEnabled || value.camera.hide;
		return value;
	};
	const send = () => {
		if (!available || !pending || !worker || disposed) return;
		const buffer = pending;
		pending = undefined;
		available = false;
		worker.postMessage({ type: "frame", buffer }, [buffer]);
	};
	const schedule = async () => {
		const value = config();
		if (!value || disposed || starting) return;
		try {
			if (connected()) {
				await commands.updateCapturePreview(value, playing() && visible());
			} else {
				starting = true;
				const port = await commands.startCapturePreview(
					value,
					playing() && visible(),
				);
				if (disposed) {
					await commands.stopCapturePreview();
					return;
				}
				socket?.close();
				socket = new WebSocket(`ws://127.0.0.1:${port}/?paced=true`);
				socket.binaryType = "arraybuffer";
				socket.onmessage = (event: MessageEvent<ArrayBuffer>) => {
					pending = event.data;
					send();
				};
				socket.onopen = () => {
					setConnected(true);
					setError("");
				};
				socket.onerror = () => setError("画面连接失败，请重试");
				socket.onclose = () => {
					if (!disposed) {
						setConnected(false);
						setError("画面连接已断开，点击重试");
					}
				};
			}
		} catch (e) {
			if (!disposed) setError(String(e));
		} finally {
			starting = false;
		}
	};
	createEffect(() => {
		props.style;
		props.cameraEnabled;
		playing();
		visible();
		if (connected()) void schedule();
	});
	onMount(() => {
		worker = new FrameWorker();
		worker.onmessage = (
			event: MessageEvent<{
				type: string;
				message?: string;
				width?: number;
				height?: number;
			}>,
		) => {
			const data = event.data;
			if (data.type === "frame-rendered") {
				if (socket?.readyState === WebSocket.OPEN) socket.send("presented");
				if (data.width && data.height)
					canvas.style.setProperty(
						"--jk-preview-ratio",
						String(data.width / data.height),
					);
				setReady(true);
				setError("");
				canvas.dispatchEvent(
					new CustomEvent("preview-presented", {
						detail: { time: performance.now(), ...data },
					}),
				);
			}
			if (["ready", "frame-rendered", "request-frame"].includes(data.type)) {
				available = true;
				send();
			} else if (data.type === "error")
				setError(data.message ?? "输出画面暂时不可用");
		};
		const offscreen = canvas.transferControlToOffscreen();
		worker.postMessage(
			{
				type: "init-canvas",
				canvas: offscreen,
				preserveAlpha: true,
				renderOnArrival: true,
			},
			[offscreen],
		);
		void schedule();
		const visibility = () => setVisible(document.visibilityState === "visible");
		document.addEventListener("visibilitychange", visibility);
		onCleanup(() =>
			document.removeEventListener("visibilitychange", visibility),
		);
	});
	createEffect(() => {
		if (props.style && worker && !connected() && !error()) void schedule();
	});
	onCleanup(() => {
		disposed = true;
		socket?.close();
		worker?.postMessage({ type: "cleanup" });
		worker?.terminate();
		void commands.stopCapturePreview();
	});

	return (
		<section class="jk-capture-stage" aria-label={localize("捕获画面布局示意")}>
			<div class="jk-stage-canvas jk-stage-rendered">
				<canvas
					ref={canvas}
					class="jk-stage-gpu"
					aria-label={localize("使用编辑器渲染器的画面示意")}
					style={{ opacity: ready() ? 1 : 0 }}
				/>
				<Show when={error()}>
					<button type="button" class="jk-preview-error" onClick={schedule}>
						{localize("预览暂不可用，点击重试")}
					</button>
				</Show>
				<Show when={!ready() && !error()}>
					<span class="jk-preview-loading">{localize("正在准备画面…")}</span>
				</Show>
			</div>
			<footer class="jk-stage-footer">
				<span>
					<i />
					{localize("画面示意")}
				</span>
				<button
					type="button"
					aria-pressed={playing()}
					onClick={() => {
						setPlaying(!playing());
					}}
				>
					{playing() ? localize("暂停动效") : localize("播放动效")}
				</button>
				<span>
					{ratio()
						? ASPECT_RATIOS[ratio() ?? "wideScreen"].ratio.join(":")
						: localize("适合屏幕")}
				</span>
			</footer>
		</section>
	);
}
