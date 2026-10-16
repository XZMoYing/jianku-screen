(() => {
	const invoke = (command, args = {}) =>
		window.__TAURI_INTERNALS__.invoke(command, args);
	const send = (value) =>
		invoke("plugin:event|emit", {
			event: "jianku-ui-review",
			payload: { route: location.pathname, ...value },
		});
	const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const wait = async (read) => {
		for (let i = 0; i < 300; i++) {
			const value = read();
			if (value) return value;
			await sleep(100);
		}
		throw new Error("Timed out waiting for control");
	};
	addEventListener(
		"error",
		(event) => void send({ phase: "error", error: event.message }),
	);
	addEventListener(
		"unhandledrejection",
		(event) => void send({ phase: "rejection", error: String(event.reason) }),
	);
	addEventListener(
		"securitypolicyviolation",
		(event) => void send({ phase: "csp", blocked: event.blockedURI }),
	);
	addEventListener(
		"DOMContentLoaded",
		() =>
			void (async () => {
				if (location.pathname === "/") {
					await invoke("show_window", {
						window: { Main: { init_target_mode: null } },
					});
					await sleep(1200);
					await send({
						phase: "startup-visibility",
						visibility: document.visibilityState,
					});
					const original = await invoke("get_capture_style");
					try {
						await wait(() =>
							document.querySelector("[data-background-category]"),
						);
						const click = async (category) =>
							(
								await wait(() =>
									document.querySelector(
										`[data-background-category="${category}"]`,
									),
								)
							).click();
						await click("desktop");
						const desktop = await wait(() =>
							document.querySelector("[data-testid=desktop-background-tile]"),
						);
						desktop.click();
						await sleep(650);
						const selected = await invoke("get_capture_style");
						for (const category of [
							"wallpaper",
							"pattern",
							"image",
							"color",
							"gradient",
							"animatedGradient",
							"desktop",
						]) {
							await click(category);
							await sleep(350);
							const current = await invoke("get_capture_style");
							if (
								JSON.stringify(current.config.background) !==
								JSON.stringify(selected.config.background)
							)
								throw new Error(`Category changed background: ${category}`);
						}
						await send({ phase: "category-browse", ok: true, categories: 7 });
						await click("pattern");
						await sleep(350);
						const tile = await wait(() =>
							document.querySelector(".jk-background-tile"),
						);
						tile.click();
						await sleep(800);
						let pattern;
						for (let attempt = 0; attempt < 20; attempt++) {
							pattern = await invoke("get_capture_style");
							if (pattern.config.background.source.path?.includes("pattern-"))
								break;
							await sleep(300);
						}
						if (!pattern.config.background.source.path?.includes("pattern-"))
							throw new Error(
								`Pattern was not applied: ${JSON.stringify(pattern.config.background.source)}`,
							);
						await click("desktop");
						await sleep(350);
						document
							.querySelector("[data-testid=desktop-background-tile]")
							.click();
						await sleep(1600);
						const restored = await invoke("get_capture_style");
						if (
							restored.config.background.source.path !==
							selected.config.background.source.path
						)
							throw new Error("Desktop background could not be restored");
						await send({
							phase: "desktop-restore",
							ok: true,
							pattern: pattern.config.background.source.path,
						});
						await click("gradient");
						await sleep(350);
						const gradient = await wait(() =>
							document.querySelector(
								".jk-background-settings button[style*=linear-gradient]",
							),
						);
						gradient.click();
						await sleep(650);
						const play = await wait(() =>
							Array.from(
								document.querySelectorAll(".jk-stage-footer button"),
							).find((button) => /播放|Play/.test(button.textContent)),
						);
						const canvas = document.querySelector(".jk-stage-gpu");
						const points = [];
						const collect = (event) => points.push(event.detail.time);
						canvas.addEventListener("preview-presented", collect);
						play.click();
						await sleep(16000);
						play.click();
						canvas.removeEventListener("preview-presented", collect);
						const steady = points.filter((time) => time > points[0] + 3000);
						const intervals = steady
							.slice(1)
							.map((time, i) => time - steady[i])
							.sort((a, b) => a - b);
						await send({
							phase: "preview-cadence",
							frames: steady.length,
							fps: ((steady.length - 1) * 1000) / (steady.at(-1) - steady[0]),
							medianMs: intervals[Math.floor(intervals.length * 0.5)],
							p95Ms: intervals[Math.floor(intervals.length * 0.95)],
							maxMs: intervals.at(-1),
							gapsOver50Ms: intervals.filter((time) => time > 50).length,
							resolution: [canvas.width, canvas.height],
							visibility: document.visibilityState,
						});
						const reference = (await invoke("get_capture_style")).config;
						reference.camera.hide = true;
						const legacy = [];
						for (let i = 0; i < 12; i++) {
							const start = performance.now();
							const result = await invoke("render_capture_preview", {
								config: reference,
								time: i / 30,
							});
							const buffer = Uint8Array.from(atob(result), (c) =>
								c.charCodeAt(0),
							).buffer;
							const header = new DataView(buffer);
							const width = header.getUint32(0, true),
								height = header.getUint32(4, true),
								stride = header.getUint32(8, true);
							const pixels = new Uint8ClampedArray(width * height * 4),
								rows = new Uint8Array(buffer, 12);
							for (let y = 0; y < height; y++)
								pixels.set(
									rows.subarray(y * stride, y * stride + width * 4),
									y * width * 4,
								);
							legacy.push(performance.now() - start + 1000 / 30);
						}
						await send({
							phase: "legacy-serial-baseline",
							averageIntervalMs:
								legacy.slice(2).reduce((a, b) => a + b, 0) / 10,
							fpsUpperBound: 10000 / legacy.slice(2).reduce((a, b) => a + b, 0),
							samples: legacy,
						});
						await send({ phase: "home-complete", ok: true });
					} finally {
						await sleep(1800);
						await invoke("set_capture_style", { style: original });
					}
				} else if (location.pathname === "/editor") {
					const path = await invoke("get_editor_project_path");

					if (path?.includes("界面验收-20261016-像素17.jks")) {
						const style = await invoke("get_capture_style");
						style.config.camera.hide = true;
						style.config.background.source = {
							type: "gradient",
							from: [160, 144, 111],
							to: [241, 231, 206],
							angle: 135,
						};
						const reference = await invoke("render_capture_preview", {
							config: style.config,
							time: 0.7,
						});
						const raw = Uint8Array.from(atob(reference), (c) =>
							c.charCodeAt(0),
						);
						const view = new DataView(raw.buffer);
						const width = view.getUint32(0, true),
							height = view.getUint32(4, true),
							stride = view.getUint32(8, true);
						const pixels = (bytes, offset, rowStride) => {
							const out = new Uint8Array(width * height * 4);
							for (let y = 0; y < height; y++)
								out.set(
									bytes.subarray(
										offset + y * rowStride,
										offset + y * rowStride + width * 4,
									),
									y * width * 4,
								);
							return out;
						};
						const before = new Uint8Array(
							await crypto.subtle.digest("SHA-256", pixels(raw, 12, stride)),
						);
						const port = await invoke("start_capture_preview", {
							config: style.config,
							playing: false,
						});
						const socket = new WebSocket(`ws://127.0.0.1:${port}/?paced=true`);
						socket.binaryType = "arraybuffer";
						try {
							const data = await new Promise((resolve, reject) => {
								const timeout = setTimeout(
									() => reject(new Error("Parity frame timeout")),
									10000,
								);
								socket.onmessage = (event) => {
									clearTimeout(timeout);
									resolve(event.data);
								};
								socket.onerror = () =>
									reject(new Error("Parity transport failed"));
							});
							const bytes = new Uint8Array(data),
								meta = new DataView(data, bytes.length - 24, 24);
							if (
								meta.getUint32(8, true) !== width ||
								meta.getUint32(4, true) !== height
							)
								throw new Error("Parity dimensions differ");
							const after = new Uint8Array(
								await crypto.subtle.digest(
									"SHA-256",
									pixels(bytes, 0, meta.getUint32(0, true)),
								),
							);
							const equal = before.every(
								(value, index) => value === after[index],
							);
							await send({
								phase: "preview-rgba-parity",
								ok: equal,
								width,
								height,
								bytes: width * height * 4,
							});
							if (!equal) throw new Error("Preview pixel parity failed");
						} finally {
							socket.close();
							await invoke("stop_capture_preview");
						}
						return;
					}

					if (path?.includes("界面验收-20261016-背景17.jks")) {
						const read = async () => {
							const raw = await invoke("plugin:fs|read_text_file", {
								path: `${path}/project-config.json`,
								options: {},
							});
							return JSON.parse(
								typeof raw === "string"
									? raw
									: new TextDecoder().decode(new Uint8Array(raw)),
							);
						};
						await wait(() =>
							document.querySelector("[data-background-category]"),
						);
						const before = await read();
						for (const category of [
							"desktop",
							"wallpaper",
							"pattern",
							"image",
							"color",
							"gradient",
							"animatedGradient",
						]) {
							(
								await wait(() =>
									document.querySelector(
										`[data-background-category="${category}"]`,
									),
								)
							).click();
							await sleep(450);
							const current = await read();
							if (
								JSON.stringify(current.background) !==
								JSON.stringify(before.background)
							)
								throw new Error(`Editor browse mutated project: ${category}`);
						}
						await send({
							phase: "editor-background-browse",
							ok: true,
							categories: 7,
						});
						document
							.querySelector('[data-background-category="pattern"]')
							.click();
						await sleep(400);
						(
							await wait(() => document.querySelector(".jk-background-tile"))
						).click();
						await sleep(1800);
						const pattern = await read();
						if (!pattern.background.source.path?.includes("pattern-"))
							throw new Error(
								"Editor pattern not applied: " +
									JSON.stringify(pattern.background.source),
							);
						document
							.querySelector('[data-background-category="desktop"]')
							.click();
						await sleep(400);
						(
							await wait(() =>
								document.querySelector(
									'[data-testid="desktop-background-tile"]',
								),
							)
						).click();
						await sleep(1800);
						const desktop = await read();
						document
							.querySelector('[data-background-category="pattern"]')
							.click();
						await sleep(400);
						(
							await wait(() => document.querySelector(".jk-background-tile"))
						).click();
						await sleep(1800);
						document
							.querySelector('[data-background-category="desktop"]')
							.click();
						await sleep(400);
						document
							.querySelector('[data-testid="desktop-background-tile"]')
							.click();
						await sleep(1800);
						const restored = await read();
						if (
							restored.background.source.path !== desktop.background.source.path
						)
							throw new Error("Editor desktop not restored");
						await send({
							phase: "editor-background-restore",
							ok: true,
							source: restored.background.source.type,
						});
						return;
					}
					if (!path?.includes("界面验收-20261016-布局.jks")) return;
					await wait(() =>
						document.querySelector("[data-background-category]"),
					);
					const metrics = [];
					for (const tab of [
						"cursor",
						"audio",
						"background",
						"keyboard",
						"background",
					]) {
						const button = document.querySelector(
							`[data-inspector-tab="${tab}"]`,
						);
						if (button?.disabled) continue;
						button.click();
						await sleep(950);
						const panels = Array.from(
							document.querySelectorAll("[role=tabpanel]"),
						).filter((panel) => !panel.hidden && panel.offsetHeight);
						metrics.push({
							tab,
							visible: panels.map((panel) => panel.dataset.value),
							text: panels.map((panel) => panel.textContent.slice(0, 60)),
						});
					}
					await send({
						phase: "editor-tabs",
						ok: metrics.every((item) => item.visible.length > 0),
						metrics,
					});
				}
			})().catch(
				(error) =>
					void send({
						phase: "failed",
						error: String(error),
						stack: error.stack,
					}),
			),
	);
})();
