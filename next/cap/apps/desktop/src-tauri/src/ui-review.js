(() => {
	const invoke = (command, args = {}) =>
		window.__TAURI_INTERNALS__.invoke(command, args);
	const send = (value) =>
		invoke("plugin:event|emit", {
			event: "jianku-ui-review",
			payload: { route: location.pathname, ...value },
		}).catch(() => {});
	const warn = console.warn.bind(console);
	console.warn = (...args) => {
		warn(...args);
		if (String(args[0]).startsWith("[Player]"))
			send({ phase: "player", messages: args });
	};
	addEventListener("securitypolicyviolation", (event) =>
		send({
			phase: "csp",
			blocked: event.blockedURI,
			directive: event.effectiveDirective,
		}),
	);
	addEventListener("error", (e) =>
		send({ error: e.message, stack: e.error?.stack }),
	);
	addEventListener("unhandledrejection", (e) =>
		send({ rejection: String(e.reason), stack: e.reason?.stack }),
	);
	addEventListener("DOMContentLoaded", () => {
		let count = 0;
		const timer = setInterval(() => {
			const canvas = document.querySelector("canvas");
			const rect = (e) =>
				e
					? {
							width: e.getBoundingClientRect().width,
							height: e.getBoundingClientRect().height,
						}
					: null;
			send({
				phase: "dom",
				visibility: document.visibilityState,
				title: document.title,
				width: innerWidth,
				height: innerHeight,
				dark: document.documentElement.classList.contains("dark"),
				colorSource: document.documentElement.dataset.jkColorSource,
				colorSeed: document.documentElement.dataset.jkColorSeed,
				primary: getComputedStyle(document.documentElement)
					.getPropertyValue("--jk-primary")
					.trim(),
				canvas: canvas
					? {
							width: canvas.width,
							height: canvas.height,
							rect: rect(canvas),
							parent: rect(canvas.parentElement),
						}
					: null,
				busy: document.querySelector("[aria-busy]")?.getAttribute("aria-busy"),
				body: rect(document.body),
				images: Array.from(document.images)
					.map((i) => ({
						width: i.naturalWidth,
						height: i.naturalHeight,
						complete: i.complete,
					}))
					.slice(0, 6),
			});
			if (++count >= 12) clearInterval(timer);
		}, 1000);
		if (location.pathname === "/") {
			setTimeout(async () => {
				const style = await invoke("get_capture_style");
				const canvas = document.querySelector(".jk-stage-gpu");
				if (
					style.config.background.source.type === "gradient" &&
					canvas?.width > 300
				)
					send({
						phase: "synthetic-preview-png",
						png: canvas.toDataURL("image/png"),
					});
			}, 3000);
		}

		if (location.pathname === "/editor") {
			setTimeout(async () => {
				const separator = document.querySelector(".jk-inspector-divider");
				const pane = document.querySelector(".jk-inspector-pane");
				if (!separator || !pane)
					return send({ phase: "inspector-resize", missing: true });
				const initial = pane.getBoundingClientRect().width;
				separator.dispatchEvent(
					new PointerEvent("pointerdown", {
						bubbles: true,
						button: 0,
						clientX: 800,
					}),
				);
				window.dispatchEvent(new PointerEvent("pointermove", { clientX: 728 }));
				const dragged = pane.getBoundingClientRect().width;
				window.dispatchEvent(new PointerEvent("pointermove", { clientX: 800 }));
				window.dispatchEvent(new PointerEvent("pointerup"));
				send({
					phase: "inspector-resize",
					initial,
					dragged,
					restored: pane.getBoundingClientRect().width,
				});
				const selected = document.querySelector(
					".jk-inspector [role=tab][aria-selected=true]",
				);
				const cursor = document.querySelector(
					".jk-inspector [role=tab][data-inspector-tab=cursor]",
				);
				cursor?.click();
				await new Promise((resolve) => setTimeout(resolve, 500));
				send({
					phase: "shared-cursor-settings",
					present: !!document.querySelector(
						".jk-inspector .jk-cursor-settings",
					),
					sliderTrack: document.querySelector(".jk-inspector .jk-slider-track")
						? getComputedStyle(
								document.querySelector(".jk-inspector .jk-slider-track"),
							).height
						: null,
				});
				selected?.click();
			}, 1400);
		}

		if (location.pathname === "/editor") {
			setTimeout(async () => {
				let callback;
				try {
					const projectPath = await invoke("get_editor_project_path");
					if (!projectPath?.endsWith("/界面验收-20261016-动态背景.jks")) return;
					let progressMessages = 0;
					callback = window.__TAURI_INTERNALS__.transformCallback(() => {
						progressMessages++;
					});
					const started = performance.now();
					const path = await invoke("export_video", {
						projectPath,
						progress: `__CHANNEL__:${callback}`,
						settings: {
							format: "Mp4",
							fps: 30,
							resolution_base: { x: 960, y: 600 },
							compression: "Web",
							custom_bpp: null,
							force_ffmpeg_decoder: true,
							optimize_filesize: false,
						},
					});
					send({
						phase: "dynamic-background-export",
						path,
						progressMessages,
						elapsedMs: performance.now() - started,
					});
				} catch (error) {
					send({ phase: "dynamic-background-export", error: String(error) });
				} finally {
					if (callback !== undefined)
						window.__TAURI_INTERNALS__.unregisterCallback(callback);
				}
			}, 2800);
		}

		if (location.pathname.startsWith("/settings")) {
			setTimeout(async () => {
				const initial =
					document.querySelector(
						".jk-theme-option[aria-checked=true] [data-theme]",
					)?.dataset.theme ??
					(document.documentElement.classList.contains("dark")
						? "dark"
						: "light");
				const choose = (theme) =>
					document
						.querySelector(`.jk-theme-option:has([data-theme="${theme}"])`)
						?.click();
				choose("dark");
				await new Promise((resolve) => setTimeout(resolve, 220));
				send({
					phase: "theme-dark",
					dark: document.documentElement.classList.contains("dark"),
					ink: getComputedStyle(document.documentElement)
						.getPropertyValue("--jk-ink")
						.trim(),
				});
				choose("system");
				await new Promise((resolve) => setTimeout(resolve, 220));
				send({
					phase: "theme-dark-to-system",
					dark: document.documentElement.classList.contains("dark"),
				});
				for (const theme of [
					"light",
					"dark",
					"system",
					"dark",
					"light",
					"system",
				])
					choose(theme);
				await new Promise((resolve) => setTimeout(resolve, 220));
				send({
					phase: "theme-rapid-to-system",
					dark: document.documentElement.classList.contains("dark"),
				});
				choose(initial);
				await new Promise((resolve) => setTimeout(resolve, 220));
				send({
					phase: "theme-restored",
					dark: document.documentElement.classList.contains("dark"),
					restored: initial,
				});
			}, 350);

			setTimeout(async () => {
				const language = [...document.querySelectorAll("select")].find(
					(select) =>
						[...select.options].some((option) => option.value === "en") &&
						[...select.options].some((option) => option.value === "zh-CN"),
				);
				if (!language) return send({ phase: "language", missing: true });
				const initial = language.value;
				for (const value of ["en", "zh-CN"]) {
					language.value = value;
					language.dispatchEvent(new Event("change", { bubbles: true }));
					await new Promise((resolve) => setTimeout(resolve, 220));
					send({
						phase: "language",
						selected: value,
						lang: document.documentElement.lang,
						selectorLabel: language.getAttribute("aria-label"),
					});
				}
				language.value = initial;
				language.dispatchEvent(new Event("change", { bubbles: true }));
				const account = [...document.querySelectorAll("button")].find(
					(button) => ["登录", "Sign In"].includes(button.textContent.trim()),
				);
				account?.click();
				await new Promise((resolve) => setTimeout(resolve, 300));
				send({
					phase: "account-placeholder",
					found: !!account,
					prompt:
						document.body.textContent.includes("敬请期待") ||
						document.body.textContent.includes("coming soon"),
				});
			}, 1600);
			setTimeout(async () => {
				try {
					const wallpaper = await invoke("get_desktop_wallpaper", {
						projectPath: null,
					});
					send({
						phase: "desktop-wallpaper",
						animated: wallpaper.animated,
						videoExtension: wallpaper.path.split(".").pop(),
					});
					if (wallpaper.animated) {
						const style = await invoke("get_capture_style");
						style.config.background.source = {
							type: "wallpaper",
							path: wallpaper.path,
						};
						style.config.camera.hide = true;
						style.config.background.padding = 30;
						const hash = (value) => {
							const raw = atob(value);
							let hash = 2166136261;
							for (let i = 12; i < Math.min(raw.length, 30000); i += 16)
								hash = Math.imul(hash ^ raw.charCodeAt(i), 16777619);
							return hash >>> 0;
						};
						const start = performance.now();
						const first = await invoke("render_capture_preview", {
							config: style.config,
							time: 0,
						});
						const second = await invoke("render_capture_preview", {
							config: style.config,
							time: 0.8,
						});
						send({
							phase: "dynamic-wallpaper-render",
							firstHash: hash(first),
							secondHash: hash(second),
							elapsedMs: performance.now() - start,
						});
					}
				} catch (error) {
					send({ phase: "dynamic-wallpaper-render", error: String(error) });
				}
			}, 2400);

			invoke("get_current_wallpaper_preview")
				.then((path) => send({ phase: "wallpaper", available: !!path }))
				.catch((e) => send({ phase: "wallpaper", error: String(e) }));
		}
	});
})();
