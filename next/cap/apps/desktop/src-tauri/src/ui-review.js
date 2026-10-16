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
		if (location.pathname.startsWith("/settings")) {
			setTimeout(async () => {
				const initial = document.documentElement.classList.contains("dark")
					? "dark"
					: "light";
				const choose = (theme) =>
					document
						.querySelector(`.jk-theme-option:has([data-theme="${theme}"])`)
						?.click();
				choose("dark");
				await new Promise((resolve) => setTimeout(resolve, 600));
				send({
					phase: "theme-dark",
					dark: document.documentElement.classList.contains("dark"),
					ink: getComputedStyle(document.documentElement)
						.getPropertyValue("--jk-ink")
						.trim(),
				});
				choose(initial);
				await new Promise((resolve) => setTimeout(resolve, 600));
				send({
					phase: "theme-restored",
					dark: document.documentElement.classList.contains("dark"),
					restored: initial,
				});
			}, 1800);

			invoke("get_current_wallpaper_preview")
				.then((path) => send({ phase: "wallpaper", available: !!path }))
				.catch((e) => send({ phase: "wallpaper", error: String(e) }));
		}
	});
})();
