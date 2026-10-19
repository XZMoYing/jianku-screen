(() => {
	const invoke = (command, args = {}) =>
		window.__TAURI_INTERNALS__.invoke(command, args);
	const emit = (payload) =>
		invoke("plugin:event|emit", {
			event: "jianku-ui-review",
			payload: { route: location.pathname, ...payload },
		}).catch(() => {});
	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	let frames = 0;
	const OriginalWebSocket = window.WebSocket;
	window.WebSocket = class extends OriginalWebSocket {
		constructor(...args) {
			super(...args);
			this.addEventListener("message", () => frames++);
		}
	};
	addEventListener("error", (event) =>
		emit({ phase: "error", message: event.message }),
	);
	addEventListener("unhandledrejection", (event) =>
		emit({ phase: "rejection", message: String(event.reason) }),
	);
	addEventListener("DOMContentLoaded", () => {
		if (location.pathname.startsWith("/settings")) {
			const timer = setInterval(async () => {
				const root = document.querySelector(".jk-settings-navigation");
				const selected = root?.querySelector('[aria-current="page"]');
				const pill = root?.querySelector(".jk-selection-pill");
				if (!root || !selected || !pill || !pill.clientWidth) return;
				clearInterval(timer);
				await wait(800);
				const snapshot = (phase) => {
					const active = root.querySelector('[aria-current="page"]');
					const a = active.getBoundingClientRect();
					const p = pill.getBoundingClientRect();
					emit({
						phase,
						scroll: root.scrollTop,
						listScroll: root.querySelector("ul").scrollTop,
						deltaX: p.left - a.left,
						deltaY: p.top - a.top,
						heightDelta: p.height - a.height,
						active: active.textContent,
						scrollHeight: root.scrollHeight,
						clientHeight: root.clientHeight,
					});
				};
				snapshot("settings-before-scroll");
				root.scrollTop = 70;
				await wait(200);
				snapshot("settings-scrolled");
				root.querySelector('a[href$="quality"]').click();
				await wait(1200);
				snapshot("settings-switched");
				root.scrollTop = 0;
				root.querySelector('a[href$="general"]').click();
				await wait(1200);
				snapshot("settings-restored");
				emit({
					phase: "settings-complete",
					account: document.querySelector(".cap-settings-profile-copy")
						?.innerText,
					updates: document.querySelector(".cap-settings-account")?.innerText,
				});
			}, 500);
			return;
		}
		if (location.pathname !== "/editor") return;
		const timer = setInterval(async () => {
			const play = document.querySelector("button.bg-ed-text-1.rounded-full");
			if (!play || !document.querySelector(".jk-inspector")) return;
			clearInterval(timer);
			await wait(2500);
			emit({
				phase: "localization",
				name: document.querySelector(".jk-editor-header input")?.value,
				quality: Array.from(
					document.querySelectorAll('[aria-label="预览画质"] button'),
				).map((el) => el.textContent),
				zoom: Array.from(document.querySelectorAll(".jk-timeline-card span"))
					.filter((el) => /缩放|Zoom/.test(el.textContent))
					.map((el) => el.textContent),
			});
			const keyboard = document.querySelector(
				'[data-inspector-tab="keyboard"]',
			);
			keyboard?.click();
			await wait(800);
			emit({
				phase: "keyboard",
				text: document.querySelector(".jk-inspector")?.innerText,
			});
			const captions = document.querySelector(
				'[data-inspector-tab="captions"]',
			);
			captions?.click();
			await wait(800);
			emit({
				phase: "captions",
				text: document.querySelector(".jk-inspector")?.innerText,
			});
			document.querySelector('[data-inspector-tab="background"]')?.click();
			const snapshot = (phase) =>
				emit({
					phase,
					frames,
					time: Array.from(document.querySelectorAll("span.tabular-nums"))
						.slice(0, 3)
						.map((el) => el.textContent),
					visibility: document.visibilityState,
				});
			snapshot("ready");
			play.click();
			await wait(31000);
			snapshot("before-pause");
			play.click();
			await wait(200);
			const previous = play.closest("div.flex-none").querySelector("button");
			previous.click();
			await wait(200);
			const ruler = document.querySelector(".jk-timeline-card .z-40.right-0");
			const rect = ruler.getBoundingClientRect();
			ruler.dispatchEvent(
				new MouseEvent("mousedown", {
					bubbles: true,
					button: 0,
					buttons: 1,
					clientX: rect.left,
					clientY: rect.top + rect.height / 2,
				}),
			);
			window.dispatchEvent(
				new MouseEvent("mouseup", {
					bubbles: true,
					button: 0,
					clientX: rect.left,
					clientY: rect.top + rect.height / 2,
				}),
			);
			await wait(100);
			snapshot("rewound");
			play.click();
			for (let sample = 0; sample < 6; sample++) {
				await wait(1000);
				snapshot(`resumed-${sample}`);
			}
			play.click();
			emit({ phase: "playback-complete" });
			await invoke("show_window", {
				window: { Settings: { page: "general" } },
			});
		}, 500);
	});
})();
