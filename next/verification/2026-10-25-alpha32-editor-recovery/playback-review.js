(() => {
	const frames = [];
	let collecting = false;
	let latest = -1;
	const NativeSocket = window.WebSocket;
	window.WebSocket = class extends NativeSocket {
		constructor(...args) {
			super(...args);
			this.addEventListener("message", (event) => {
				if (!(event.data instanceof ArrayBuffer) || event.data.byteLength < 24)
					return;
				latest = new DataView(event.data, event.data.byteLength - 24).getUint32(
					12,
					true,
				);
			});
		}
	};
	const NativeWorker = window.Worker;
	window.Worker = class extends NativeWorker {
		constructor(...args) {
			super(...args);
			this.addEventListener("message", (event) => {
				if (event.data?.type === "corrected") latest = event.data.frameNumber;
			});
		}
	};
	let sampledRenderCount = 0;
	const sample = () => {
		const stats = window.__capFpsStats?.();
		if (
			collecting &&
			stats &&
			stats.renderCount > 0 &&
			stats.renderCount !== sampledRenderCount
		) {
			frames.push({
				number: latest,
				at: performance.now(),
				transport: stats.transportMode,
			});
		}
		if (stats) sampledRenderCount = stats.renderCount;
		requestAnimationFrame(sample);
	};
	requestAnimationFrame(sample);

	const invoke = (command, args = {}) =>
		window.__TAURI_INTERNALS__.invoke(command, args);
	const emit = (payload) =>
		invoke("plugin:event|emit", {
			event: "jianku-ui-review",
			payload: { route: location.pathname, ...payload },
		});
	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const until = async (read, label, timeout = 5000) => {
		const started = performance.now();
		while (performance.now() - started < timeout) {
			const result = read();
			if (result) return result;
			await wait(20);
		}
		throw new Error(`Timed out: ${label}`);
	};
	const play = () =>
		document.querySelector("button.bg-ed-text-1[aria-pressed]");
	const playing = () => play()?.getAttribute("aria-pressed") === "true";
	const pause = async () => {
		if (!playing()) return;
		play().click();
		await until(() => !playing(), "pause completed");
	};
	const rewind = () => {
		const ruler = document.querySelector(".jk-timeline-card .z-40.right-0");
		if (!ruler) throw new Error("Missing timeline ruler");
		const bounds = ruler.getBoundingClientRect();
		const position = {
			bubbles: true,
			button: 0,
			clientX: bounds.left,
			clientY: bounds.top + bounds.height / 2,
		};
		ruler.dispatchEvent(
			new MouseEvent("mousedown", { ...position, buttons: 1 }),
		);
		window.dispatchEvent(new MouseEvent("mouseup", position));
	};
	const labels = () =>
		Array.from(document.querySelectorAll("span.tabular-nums"))
			.slice(0, 3)
			.map((node) => node.textContent);
	window.addEventListener("DOMContentLoaded", () => {
		void (async () => {
			if (location.pathname !== "/editor") return;
			await until(play, "play button", 25000);
			await wait(1200);
			await emit({
				phase: "ready",
				transport: window.__capFpsStats?.().transportMode,
				project: await invoke("get_editor_project_path"),
			});
			for (let cycle = 0; cycle < 3; cycle++) {
				await pause();
				play().click();
				await until(playing, "play started");
				await wait(cycle % 3 === 0 ? 2600 : 650);
				await pause();
				const before = labels();
				if (cycle % 4 === 3)
					play().closest("div.flex-none").querySelector("button").click();
				else rewind();
				await wait(cycle % 2 ? 150 : 40);
				const first = frames.length;
				const requestedAt = performance.now();
				sampledRenderCount = window.__capFpsStats?.().renderCount ?? 0;
				collecting = true;
				play().click();
				await until(playing, "resume started");
				await until(
					() => frames.length - first >= 12 && frames.at(-1)?.number >= 45,
					"resumed frames progressed",
					4000,
				);
				await pause();
				collecting = false;
				const resumed = frames.slice(first);
				const passed = resumed[0].number <= 10 && resumed.at(-1).number >= 45;
				await emit({
					phase: "cycle",
					cycle,
					method: cycle % 4 === 3 ? "start-button" : "timeline-ruler",
					before,
					after: labels(),
					firstFrameMs: resumed[0].at - requestedAt,
					passed,
					frames: resumed,
				});
				if (!passed) throw new Error(`Wrong restart frame at cycle ${cycle}`);
			}
			await emit({ phase: "complete", cycles: 3 });
		})().catch(async (error) => {
			collecting = false;
			await emit({
				phase: "error",
				message: String(error),
				labels: labels(),
				lastFrames: frames.slice(-100),
			});
		});
	});
})();
