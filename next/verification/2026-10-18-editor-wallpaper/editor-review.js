(() => {
	const invoke = (command, args = {}) =>
		window.__TAURI_INTERNALS__.invoke(command, args);
	const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const send = (value) =>
		invoke("plugin:event|emit", {
			event: "jianku-ui-review",
			payload: { route: location.pathname, ...value },
		});
	const frames = [];
	let incoming;
	const NativeSocket = window.WebSocket;
	window.WebSocket = class extends NativeSocket {
		constructor(...args) {
			super(...args);
			this.addEventListener("message", (event) => {
				if (event.data instanceof ArrayBuffer && event.data.byteLength > 24) {
					const tail = new DataView(event.data, event.data.byteLength - 24);
					incoming = {
						width: tail.getUint32(4, true),
						height: tail.getUint32(8, true),
						number: tail.getUint32(12, true),
					};
				}
			});
		}
	};
	const putImageData = CanvasRenderingContext2D.prototype.putImageData;
	CanvasRenderingContext2D.prototype.putImageData = function (data, ...args) {
		const result = putImageData.call(this, data, ...args);
		if (this.canvas.isConnected && data.width >= 200 && data.height >= 200)
			frames.push({
				at: performance.now(),
				...incoming,
				width: data.width,
				height: data.height,
			});
		return result;
	};
	const NativeWorker = window.Worker;
	window.Worker = class extends NativeWorker {
		constructor(...args) {
			super(...args);
			this.addEventListener("message", (event) => {
				if (event.data.type === "frame-rendered")
					frames.push({
						at: performance.now(),
						number: event.data.frameNumber,
						width: event.data.width,
						height: event.data.height,
					});
			});
		}
	};
	const measure = async (phase, ms) => {
		const start = performance.now();
		await sleep(ms);
		const end = performance.now();
		const points = frames.filter((v) => v.at >= start && v.at <= end);
		const gaps = points
			.slice(1)
			.map((v, i) => v.at - points[i].at)
			.sort((a, b) => a - b);
		await send({
			phase,
			visibility: document.visibilityState,
			frames: points.length,
			fps: (points.length * 1000) / (end - start),
			p95: gaps[Math.floor(gaps.length * 0.95)] ?? null,
			max: gaps.at(-1) ?? null,
			uniqueFrames: new Set(points.map((v) => v.number)).size,
			last: points.at(-1),
		});
	};
	addEventListener(
		"DOMContentLoaded",
		() =>
			void (async () => {
				try {
					if (location.pathname === "/") {
						await sleep(1400);
						await invoke("show_window", {
							window: {
								Editor: { project_path: "/tmp/jianku20-fixtures/editor.jks" },
							},
						});
						return;
					}
					if (location.pathname !== "/editor") return;
					for (let i = 0; i < 100; i++) {
						try {
							if (
								(await invoke("get_editor_project_path")) ===
									"/tmp/jianku20-fixtures/editor.jks" &&
								document.querySelector("button.bg-ed-text-1")
							)
								break;
						} catch {}
						await sleep(200);
					}
					const path = await invoke("get_editor_project_path");
					if (path !== "/tmp/jianku20-fixtures/editor.jks") return;
					const label = window.__TAURI_INTERNALS__.metadata.currentWindow.label;
					await invoke("plugin:window|set_always_on_top", {
						label,
						value: true,
					});
					await invoke("plugin:window|set_focus", { label });
					await sleep(1200);
					const qualityButtons = [
						...document.querySelectorAll(
							'button[aria-label$="preview quality"]',
						),
					];
					const originalQuality = qualityButtons.find(
						(b) => b.getAttribute("aria-pressed") === "true",
					);
					if (qualityButtons.length !== 3)
						throw Error("Missing preview quality controls");
					qualityButtons[0].click();
					await sleep(700);
					const play = () => {
						const b = document.querySelector("button.bg-ed-text-1");
						if (!b) throw Error("Missing player button");
						b.click();
					};
					const previewCanvas = [...document.querySelectorAll("canvas")].sort(
						(a, b) =>
							b.getBoundingClientRect().width *
								b.getBoundingClientRect().height -
							a.getBoundingClientRect().width *
								a.getBoundingClientRect().height,
					)[0];
					await send({
						phase: "ready",
						path,
						controls: document.querySelectorAll("canvas").length,
						quality: "full",
						originalQuality: originalQuality?.getAttribute("aria-label"),
						canvasBounds: previewCanvas?.getBoundingClientRect().toJSON(),
						viewport: { width: innerWidth, height: innerHeight },
					});
					play();
					await sleep(1100);
					await measure("playback", 3500);
					play();
					await sleep(600);
					const start = performance.now();
					await invoke("seek_to", { frameNumber: 90 });
					for (let i = 0; i < 300; i++) {
						if (frames.at(-1)?.number === 90) break;
						await sleep(10);
					}
					await send({
						phase: "paused-seek",
						elapsedMs: performance.now() - start,
						last: frames.at(-1),
					});
					play();
					await sleep(700);
					await measure("resume", 2500);
					play();
					await sleep(500);
					originalQuality?.click();
					await invoke("plugin:window|set_always_on_top", {
						label,
						value: false,
					});
					await send({ phase: "finished" });
				} catch (error) {
					await send({
						phase: "error",
						error: String(error),
						stack: error?.stack,
					});
				}
			})(),
	);
})();
