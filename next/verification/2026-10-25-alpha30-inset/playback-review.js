(() => {
	const received = [];
	const restarts = [];
	const presented = [];
	const stats = [];
	let collecting = false;
	let latestFrame = -1;
	const mark = (kind, frameNumber) => {
		if (collecting)
			presented.push({ kind, frameNumber, at: performance.now() });
	};
	const NativeSocket = window.WebSocket;
	window.WebSocket = class extends NativeSocket {
		constructor(...args) {
			super(...args);
			this.addEventListener("message", (event) => {
				if (!collecting || !(event.data instanceof ArrayBuffer)) return;
				if (event.data.byteLength < 24) return;
				const metadata = new DataView(event.data, event.data.byteLength - 24);
				latestFrame = metadata.getUint32(12, true);
				received.push({ frameNumber: latestFrame, at: performance.now() });
			});
		}
	};
	const NativeWorker = window.Worker;
	window.Worker = class extends NativeWorker {
		constructor(...args) {
			super(...args);
			this.addEventListener("message", (event) => {
				if (event.data?.type === "corrected")
					latestFrame = event.data.frameNumber;
				if (event.data?.type === "frame-rendered") {
					mark("worker", event.data.frameNumber);
				}
			});
		}
	};
	const nativePut = CanvasRenderingContext2D.prototype.putImageData;
	CanvasRenderingContext2D.prototype.putImageData = function (...args) {
		const result = nativePut.apply(this, args);
		if (this.canvas.id === "canvas") mark("canvas2d", latestFrame);
		return result;
	};
	if (window.GPUQueue) {
		const nativeSubmit = GPUQueue.prototype.submit;
		GPUQueue.prototype.submit = function (...args) {
			const result = nativeSubmit.apply(this, args);
			mark("webgpu-submit", latestFrame);
			return result;
		};
	}
	const invoke = (command, args = {}) =>
		window.__TAURI_INTERNALS__.invoke(command, args);
	const emit = (payload) =>
		invoke("plugin:event|emit", {
			event: "jianku-ui-review",
			payload: { route: location.pathname, ...payload },
		});
	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	window.addEventListener(
		"DOMContentLoaded",
		() =>
			void (async () => {
				if (location.pathname === "/") {
					await wait(1200);
					await invoke("show_window", {
						window: {
							Editor: {
								project_path:
									"/private/tmp/jianku-alpha30-fixtures/zoom-still.jks",
							},
						},
					});
					return;
				}
				if (location.pathname !== "/editor") return;
				let play;
				for (let i = 0; i < 120; i++) {
					play = document.querySelector("button.bg-ed-text-1.rounded-full");
					if (play && !play.disabled) break;
					await wait(250);
				}
				if (!play) throw new Error("Missing play button");
				await wait(1800);
				collecting = true;
				const started = performance.now();
				play.click();
				for (let i = 0; i < 10; i++) {
					await wait(500);
					stats.push({ at: performance.now(), ...window.__capFpsStats?.() });
				}
				play.click();
				collecting = false;
				await emit({
					phase: "playback-trace",
					started,
					received,
					presented,
					stats,
				});
				for (let cycle = 0; cycle < 3; cycle++) {
					await wait(200);
					if (cycle === 2) {
						play.closest("div.flex-none").querySelector("button").click();
					} else {
						const ruler = document.querySelector(
							".jk-timeline-card .z-40.right-0",
						);
						if (!ruler) throw new Error("Missing timeline ruler");
						const rect = ruler.getBoundingClientRect();
						const origin = {
							bubbles: true,
							button: 0,
							clientX: rect.left,
							clientY: rect.top + rect.height / 2,
						};
						ruler.dispatchEvent(
							new MouseEvent("mousedown", { ...origin, buttons: 1 }),
						);
						window.dispatchEvent(new MouseEvent("mouseup", origin));
					}
					await wait(500);
					const first = presented.length;
					const restartedAt = performance.now();
					collecting = true;
					play.click();
					await wait(1400);
					play.click();
					collecting = false;
					const frames = presented.slice(first);
					if (
						frames.length < 30 ||
						frames[0].frameNumber > 10 ||
						frames.at(-1).frameNumber < 45
					)
						throw new Error(`Playback restart failed: ${cycle}`);
					restarts.push({
						cycle,
						method: cycle === 2 ? "start-button" : "timeline-ruler",
						firstFrameMs: frames[0].at - restartedAt,
						frames,
					});
				}
				await emit({ phase: "playback-restarts", restarts });
			})().catch((error) => emit({ phase: "error", message: String(error) })),
	);
})();
