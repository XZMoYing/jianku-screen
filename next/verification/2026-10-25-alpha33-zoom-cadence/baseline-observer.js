(() => {
	const received = [],
		draws = [],
		rafs = [],
		maps = new Map();
	let collecting = false,
		cycle = -1,
		latestRaf = 0;
	const invoke = (command, args = {}) =>
		window.__TAURI_INTERNALS__.invoke(command, args);
	const emit = (payload) =>
		invoke("plugin:event|emit", { event: "jianku-ui-review", payload });
	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const fingerprint = (data, width, height, stride) => {
		let value = 2166136261;
		for (let i = 0; i < 128; i++) {
			const x = (i * 773) % width,
				y = (i * 331) % height,
				offset = y * stride + x * 4;
			for (let k = 0; k < 4; k++)
				value = Math.imul(value ^ data[offset + k], 16777619);
		}
		return value >>> 0;
	};
	const NativeSocket = window.WebSocket;
	window.WebSocket = class extends NativeSocket {
		constructor(...args) {
			super(...args);
			this.addEventListener("message", (event) => {
				if (!(event.data instanceof ArrayBuffer) || event.data.byteLength < 24)
					return;
				const buffer = event.data,
					meta = new DataView(buffer, buffer.byteLength - 24);
				const [stride, height, width, number] = [0, 4, 8, 12].map((offset) =>
					meta.getUint32(offset, true),
				);
				if (!width || !height || buffer.byteLength < stride * height + 24)
					return;
				const id = {
					number,
					pts: Number(meta.getBigUint64(16, true)),
					cycle,
					width,
					height,
					stride,
					at: performance.now(),
				};
				const hash = fingerprint(new Uint8Array(buffer), width, height, stride);
				maps.set(hash, id);
				if (collecting) received.push({ ...id, hash });
			});
		}
	};
	const original = CanvasRenderingContext2D.prototype.putImageData;
	const replacement = function (...args) {
		const result = original.apply(this, args);
		if (collecting) {
			const im = args[0],
				hash = fingerprint(im.data, im.width, im.height, im.width * 4);
			draws.push({
				at: performance.now(),
				raf: latestRaf,
				hash,
				cycle,
				canvas: this.canvas.id,
				width: im.width,
				height: im.height,
				frame: maps.get(hash),
			});
		}
		return result;
	};
	CanvasRenderingContext2D.prototype.putImageData = replacement;
	const sample = (timestamp) => {
		latestRaf = timestamp;
		if (collecting) rafs.push({ at: performance.now(), timestamp, cycle });
		requestAnimationFrame(sample);
	};
	requestAnimationFrame(sample);
	const until = async (read, label, timeout = 20000) => {
		const start = performance.now();
		while (performance.now() - start < timeout) {
			if (read()) return;
			await wait(20);
		}
		throw new Error(label);
	};
	window.addEventListener(
		"DOMContentLoaded",
		() =>
			void (async () => {
				if (location.pathname !== "/editor") return;
				const play = () =>
					document.querySelector("button.bg-ed-text-1[aria-pressed]");
				await until(play, "play button");
				await wait(1500);
				await emit({
					phase: "observer",
					patched:
						CanvasRenderingContext2D.prototype.putImageData === replacement,
					descriptor: Object.getOwnPropertyDescriptor(
						CanvasRenderingContext2D.prototype,
						"putImageData",
					),
					canvases: [...document.querySelectorAll("canvas")].map((c) => ({
						id: c.id,
						w: c.width,
						h: c.height,
					})),
					project: await invoke("get_editor_project_path"),
				});
				for (cycle = 0; cycle < 3; cycle++) {
					if (play().getAttribute("aria-pressed") === "true") {
						play().click();
						await wait(500);
					}
					play().closest("div.flex-none").querySelector("button").click();
					await wait(500);
					collecting = true;
					play().click();
					await until(
						() => play().getAttribute("aria-pressed") === "true",
						"started",
					);
					await wait(8400);
					if (play().getAttribute("aria-pressed") === "true") play().click();
					await wait(100);
					collecting = false;
					await emit({
						phase: "cycle",
						cycle,
						draws: draws.filter((f) => f.cycle === cycle),
						received: received.filter((f) => f.cycle === cycle),
						rafs: rafs.filter((f) => f.cycle === cycle),
						stats: window.__capFpsStats?.(),
					});
				}
				await emit({ phase: "complete" });
			})().catch((error) => emit({ phase: "error", error: String(error) })),
	);
})();
