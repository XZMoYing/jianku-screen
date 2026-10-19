import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import FrameWorker from "~/utils/frame-worker?worker";
import { t as localize } from "~/utils/i18n";
import { commands, type PresentationOptions } from "~/utils/tauri";

export default function PresentationOutput() {
	let canvas!: HTMLCanvasElement;
	const [options, setOptions] = createSignal<PresentationOptions>();
	const background = () => {
		const source = options()?.project.background.source;
		if (!source) return "#eeeaf6";
		const rgb = (value: number[]) => `rgb(${value.join(",")})`;
		if (source.type === "color") return rgb(source.value);
		if (source.type === "gradient")
			return `linear-gradient(${source.angle ?? 90}deg, ${rgb(source.from)}, ${rgb(source.to)})`;
		if (
			(source.type === "image" || source.type === "wallpaper") &&
			source.path?.startsWith("/")
		)
			return `url("${convertFileSrc(source.path)}") center / cover`;
		return "#eeeaf6";
	};
	const [error, setError] = createSignal("");
	const [curtain, setCurtain] = createSignal(false);
	onMount(() => {
		let disposed = false;
		let socket: WebSocket | undefined;
		let pending: ArrayBuffer | undefined;
		let available = false;
		const changes = listen<PresentationOptions>(
			"presentation-output-settings",
			(event) => setOptions(event.payload),
		);
		let curtainRevision = 0;
		const curtainChanges = listen<boolean>(
			"presentation-curtain-changed",
			(event) => {
				curtainRevision++;
				if (!disposed) setCurtain(event.payload);
			},
		);
		void curtainChanges
			.then(async () => {
				const revision = curtainRevision;
				const status = await commands.getPresentationStatus();
				if (!disposed && revision === curtainRevision)
					setCurtain(status.curtain);
			})
			.catch((cause: unknown) => setError(String(cause)));
		const setup = commands.getPresentationSetup().then((value) => {
			if (!disposed) setOptions(value.options);
		});
		void setup.catch((cause: unknown) => setError(String(cause)));
		const worker = new FrameWorker();
		const send = () => {
			if (!available || !pending || disposed) return;
			const buffer = pending;
			pending = undefined;
			available = false;
			worker.postMessage({ type: "frame", buffer }, [buffer]);
		};
		worker.onmessage = (
			event: MessageEvent<{ type: string; message?: string }>,
		) => {
			if (
				event.data.type === "frame-rendered" &&
				socket?.readyState === WebSocket.OPEN
			)
				socket.send("presented");
			if (
				event.data.type === "ready" ||
				event.data.type === "frame-rendered" ||
				event.data.type === "request-frame"
			) {
				available = true;
				send();
			} else if (event.data.type === "error")
				setError(event.data.message ?? localize("输出画面暂时不可用"));
		};
		const offscreen = canvas.transferControlToOffscreen();
		worker.postMessage(
			{ type: "init-canvas", canvas: offscreen, renderOnArrival: true },
			[offscreen],
		);
		void (async () => {
			for (let attempt = 0; attempt < 80 && !disposed; attempt++) {
				const status = await commands.getPresentationStatus();
				if (status.wsPort) {
					socket = new WebSocket(`ws://127.0.0.1:${status.wsPort}/?paced=true`);
					socket.binaryType = "arraybuffer";
					socket.onmessage = (event: MessageEvent<ArrayBuffer>) => {
						pending = event.data;
						send();
					};
					socket.onerror = () =>
						setError(localize("画面连接失败，请重新开始演示"));
					return;
				}
				await new Promise((resolve) => setTimeout(resolve, 250));
			}
			if (!disposed) setError(localize("等待演示画面超时，请重新开始"));
		})().catch((cause: unknown) => setError(String(cause)));
		onCleanup(() => {
			disposed = true;
			socket?.close();
			worker.postMessage({ type: "cleanup" });
			worker.terminate();
			void changes.then((remove) => remove());
			void curtainChanges.then((remove) => remove());
		});
	});
	return (
		<div class="fixed inset-0 cursor-none" style={{ background: background() }}>
			<canvas
				data-testid="presentation-output-canvas"
				data-tauri-drag-region
				ref={canvas}
				class="w-full h-full object-contain"
			/>
			<Show when={curtain()}>
				<div
					data-testid="presentation-curtain"
					class="absolute inset-0 flex flex-col items-center justify-center gap-3"
					style={{ background: "rgb(242, 241, 237)", color: "#4f5048" }}
				>
					<svg
						viewBox="0 0 32 32"
						class="size-10"
						fill="none"
						stroke="currentColor"
						stroke-width="1.6"
						aria-hidden="true"
					>
						<rect x="4" y="6" width="24" height="17" rx="5" />
						<path d="M11 28h10M16 23v5M4 15h24" />
					</svg>
					<span>{localize("演示暂停，稍后继续")}</span>
				</div>
			</Show>
			<Show when={error()}>
				<div class="absolute inset-0 flex items-center justify-center p-6 text-white bg-black/70">
					{error()}
				</div>
			</Show>
		</div>
	);
}
