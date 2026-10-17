(() => {
	const invoke = (command, args = {}) =>
		window.__TAURI_INTERNALS__.invoke(command, args);
	const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const send = (value) =>
		invoke("plugin:event|emit", {
			event: "jianku-ui-review",
			payload: { route: location.pathname, ...value },
		});
	const renders = [];
	const arrivals = [];
	let retainRaw = false;
	let lastRaw;
	const NativeWorker = window.Worker;
	window.Worker = class extends NativeWorker {
		constructor(...args) {
			super(...args);
			this.addEventListener("message", (event) => {
				if (event.data.type === "frame-rendered")
					renders.push({
						at: performance.now(),
						number: event.data.frameNumber,
						width: event.data.width,
						height: event.data.height,
					});
			});
		}
	};
	const NativeSocket = window.WebSocket;
	window.WebSocket = class extends NativeSocket {
		constructor(...args) {
			super(...args);
			this.addEventListener("message", (event) => {
				if (event.data instanceof ArrayBuffer) {
					arrivals.push(performance.now());
					if (retainRaw) lastRaw = event.data.slice(0);
				}
			});
		}
	};
	const metrics = (points, start, end) => {
		const times = points.filter((time) => time >= start && time <= end);
		const gaps = times
			.slice(1)
			.map((time, i) => time - times[i])
			.sort((a, b) => a - b);
		return {
			frames: times.length,
			fps: (times.length * 1000) / (end - start),
			p95: gaps[Math.floor(gaps.length * 0.95)] ?? null,
			max: gaps.at(-1) ?? null,
			gapsOver50: gaps.filter((v) => v > 50).length,
		};
	};
	const measure = async (phase, ms) => {
		const start = performance.now();
		await sleep(ms);
		const end = performance.now();
		await send({
			phase,
			elapsedMs: end - start,
			visibility: document.visibilityState,
			received: metrics(arrivals, start, end),
			rendered: metrics(
				renders.map((v) => v.at),
				start,
				end,
			),
			uniqueFrames: new Set(
				renders
					.filter((v) => v.at >= start && v.at <= end)
					.map((v) => v.number),
			).size,
			last: renders.at(-1),
		});
	};
	addEventListener(
		"error",
		(event) => void send({ phase: "error", error: event.message }),
	);
	addEventListener(
		"unhandledrejection",
		(event) => void send({ phase: "error", error: String(event.reason) }),
	);
	addEventListener(
		"DOMContentLoaded",
		() =>
			void (async () => {
				if (location.pathname === "/presentation-output") {
					await sleep(2500);
					for (let i = 0; i < 6; i++) await measure(`output-${i}`, 5000);
					return;
				}
				if (location.pathname !== "/") return;
				let originalTop = false;
				let play;
				try {
					await sleep(1500);
					originalTop = await invoke("plugin:window|is_always_on_top", {
						label: "main",
					});
					await invoke("plugin:window|set_always_on_top", {
						label: "main",
						value: true,
					});
					await invoke("close_target_select_overlays");
					await invoke("show_window", {
						window: { Main: { init_target_mode: null } },
					});
					await sleep(1000);
					const style = await invoke("get_capture_style");
					await send({
						phase: "configuration",
						background: style.config.background.source.type,
						source: style.config.background.source.path?.split("/").at(-1),
						visibility: document.visibilityState,
					});
					play = document.querySelector(".jk-stage-footer button");
					if (!play) throw new Error("Missing preview control");
					play.click();
					await sleep(3000);
					await measure("home-wallpaper-visible", 12000);
					play.click();
					await sleep(500);
					const options = (await invoke("get_presentation_setup")).options;
					options.outputMonitor = null;
					const start = performance.now();
					const initial = await invoke("start_presentation", { options });
					await invoke("plugin:window|set_always_on_top", {
						label: "presentation-output",
						value: true,
					});
					await send({
						phase: "presentation-started",
						coldMs: performance.now() - start,
						status: initial,
					});
					const before = await invoke("get_presentation_status");
					await measure("presentation-only-main", 12000);
					const after = await invoke("get_presentation_status");
					await send({
						phase: "presentation-throughput",
						frames: after.frames - before.frames,
						status: after,
					});
					play.click();
					await sleep(1000);
					await measure("home-and-presentation", 8000);
					if (play.getAttribute("aria-pressed") === "true") play.click();
					await invoke("plugin:window|hide", { label: "presentation-output" });
					const hiddenBefore = await invoke("get_presentation_status");
					await measure("presentation-hidden-main", 6000);
					const hiddenAfter = await invoke("get_presentation_status");
					await send({
						phase: "presentation-hidden-throughput",
						frames: hiddenAfter.frames - hiddenBefore.frames,
						status: hiddenAfter,
					});
					await invoke("stop_presentation");
					await sleep(700);
					const previewConfig = structuredClone(style.config);
					previewConfig.camera.hide = true;
					const referenceConfig = structuredClone(previewConfig);
					referenceConfig.background.source = {
						type: "gradient",
						from: [160, 144, 111],
						to: [241, 231, 206],
						angle: 135,
					};
					retainRaw = true;
					await invoke("update_capture_preview", {
						config: referenceConfig,
						playing: false,
					});
					for (let i = 0; i < 300 && !lastRaw; i++) await sleep(10);
					if (!lastRaw) throw new Error("Missing pixel-check frame");
					retainRaw = false;
					const encoded = await invoke("render_capture_preview", {
						config: referenceConfig,
						time: 0.7,
					});
					const reference = Uint8Array.from(atob(encoded), (character) =>
						character.charCodeAt(0),
					);
					const actual = new Uint8Array(lastRaw, 0, lastRaw.byteLength - 24);
					const expected = reference.subarray(12);
					let different = Math.abs(actual.length - expected.length);
					for (let i = 0; i < Math.min(actual.length, expected.length); i++)
						if (actual[i] !== expected[i]) different++;
					await send({
						phase: "compositor-pixels",
						bytes: actual.length,
						different,
						identical: different === 0,
					});
					await invoke("update_capture_preview", {
						config: previewConfig,
						playing: false,
					});
					await send({ phase: "finished" });
				} catch (error) {
					await send({
						phase: "error",
						error: String(error),
						stack: error?.stack,
					});
				} finally {
					if (play?.getAttribute("aria-pressed") === "true") play.click();
					await invoke("plugin:window|set_always_on_top", {
						label: "main",
						value: originalTop,
					});
				}
			})(),
	);
})();
