import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { ASPECT_RATIOS } from "~/routes/editor/projectConfig";
import { t as localize } from "~/utils/i18n";
import { type CaptureStyle, commands } from "~/utils/tauri";

export default function CaptureStage(props: {
	style: CaptureStyle | undefined;
	cameraEnabled: boolean;
}) {
	let canvas!: HTMLCanvasElement;
	let disposed = false;
	let pending = false;
	let rendering = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let started = 0;
	const [playing, setPlaying] = createSignal(false);
	const [error, setError] = createSignal("");
	const [ready, setReady] = createSignal(false);
	const ratio = () => props.style?.config.aspectRatio;
	const schedule = () => {
		pending = true;
		if (rendering || !props.style || disposed) return;
		void render();
	};
	const render = async () => {
		const style = props.style;
		if (!style || disposed) return;
		rendering = true;
		pending = false;
		try {
			const time = playing() ? ((performance.now() - started) / 1000) % 6 : 0.7;
			const config = structuredClone(style.config);
			config.camera.hide = !props.cameraEnabled || config.camera.hide;
			const result = await commands.renderCapturePreview(config, time);
			if (disposed) return;
			const buffer = Uint8Array.from(atob(result), (c) =>
				c.charCodeAt(0),
			).buffer;
			const header = new DataView(buffer);
			const width = header.getUint32(0, true);
			const height = header.getUint32(4, true);
			const stride = header.getUint32(8, true);
			const rows = new Uint8Array(buffer, 12);
			const pixels = new Uint8ClampedArray(width * height * 4);
			for (let y = 0; y < height; y++)
				pixels.set(
					rows.subarray(y * stride, y * stride + width * 4),
					y * width * 4,
				);
			canvas.width = width;
			canvas.height = height;
			canvas.style.setProperty("--jk-preview-ratio", String(width / height));
			canvas
				.getContext("2d")
				?.putImageData(new ImageData(pixels, width, height), 0, 0);
			setReady(true);
			setError("");
		} catch (error) {
			if (!disposed) {
				setError(String(error));
				setPlaying(false);
			}
		} finally {
			rendering = false;
			if (!disposed && pending) schedule();
			else if (!disposed && playing() && document.visibilityState === "visible")
				timer = setTimeout(schedule, 1000 / 30);
		}
	};
	createEffect(() => {
		props.cameraEnabled;
		if (props.style) schedule();
	});
	onMount(() => {
		const visibility = () => {
			if (document.visibilityState === "visible") schedule();
		};
		document.addEventListener("visibilitychange", visibility);
		onCleanup(() =>
			document.removeEventListener("visibilitychange", visibility),
		);
	});
	onCleanup(() => {
		disposed = true;
		if (timer) clearTimeout(timer);
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
						started = performance.now();
						if (timer) clearTimeout(timer);
						schedule();
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
