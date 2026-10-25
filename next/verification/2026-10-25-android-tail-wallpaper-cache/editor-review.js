(() => {
	const invoke = (command, args = {}) =>
		window.__TAURI_INTERNALS__.invoke(command, args);
	const emit = (value) =>
		invoke("plugin:event|emit", {
			event: "jianku-ui-review",
			payload: { route: location.pathname, ...value },
		}).catch(() => {});
	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	let frames = 0;
	const NativeSocket = window.WebSocket;
	window.WebSocket = class extends NativeSocket {
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
	addEventListener(
		"DOMContentLoaded",
		() =>
			void (async () => {
				const project = "/private/tmp/jianku-alpha28-fixtures/playback.jks";
				if (location.pathname === "/") {
					await wait(1200);
					await invoke("show_window", {
						window: { Editor: { project_path: project } },
					});
					return;
				}
				if (location.pathname !== "/editor") return;
				for (let attempt = 0; attempt < 100; attempt++) {
					if (
						document.querySelector("button.bg-ed-text-1") &&
						(await invoke("get_editor_project_path")) === project
					)
						break;
					await wait(150);
				}
				const button = document.querySelector("button.bg-ed-text-1");
				if (!button) throw Error("Editor play control missing");
				await wait(1000);
				const time = () =>
					Array.from(document.querySelectorAll("span.tabular-nums"))
						.slice(0, 3)
						.map((node) => node.textContent);
				await emit({ phase: "ready", frames, time: time() });
				for (let cycle = 0; cycle < 4; cycle++) {
					const before = frames;
					const started = performance.now();
					button.click();
					await wait(1300);
					const ended = performance.now();
					button.click();
					await emit({
						phase: "cycle",
						cycle,
						durationMs: ended - started,
						newFrames: frames - before,
						time: time(),
					});
					await wait(350);
				}
				const before = frames;
				await invoke("seek_to", { frameNumber: 360 });
				await wait(600);
				await emit({ phase: "seek", newFrames: frames - before, time: time() });
				await emit({ phase: "complete" });
			})().catch((error) => emit({ phase: "fatal", message: String(error) })),
	);
})();
