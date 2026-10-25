(() => {
	const invoke = (command, args = {}) =>
		window.__TAURI_INTERNALS__.invoke(command, args);
	const emit = (payload) =>
		invoke("plugin:event|emit", {
			event: "jianku-ui-review",
			payload: { route: location.pathname, ...payload },
		});
	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	window.addEventListener("DOMContentLoaded", () => {
		void (async () => {
			await emit({ phase: "loaded", title: document.title });
			for (let i = 0; i < 100; i++) {
				if (location.pathname === "/editor") {
					const canvas = document.querySelector("#canvas");
					if (
						canvas?.width &&
						document.querySelector("button.bg-ed-text-1[aria-pressed]")
					) {
						await emit({
							phase: "editor-ready",
							project: await invoke("get_editor_project_path"),
							canvas: [canvas.width, canvas.height],
						});
						return;
					}
				} else if (location.pathname === "/screenshot-editor") {
					if (document.querySelector('[role="slider"]')) {
						await emit({ phase: "screenshot-ready" });
						return;
					}
				} else if (location.pathname === "/") {
					if (document.querySelector('[data-testid="capture-appearance"]')) {
						await emit({ phase: "main-ready" });
						return;
					}
				} else return;
				await wait(200);
			}
			throw new Error("Window did not become ready");
		})().catch((error) => emit({ phase: "error", message: String(error) }));
	});
})();
