(() => {
	const invoke = (command, args = {}) =>
		window.__TAURI_INTERNALS__.invoke(command, args);
	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const emit = (payload) =>
		invoke("plugin:event|emit", {
			event: "jianku-ui-review",
			payload: { route: location.pathname, ...payload },
		});
	window.addEventListener(
		"DOMContentLoaded",
		() =>
			void (async () => {
				if (location.pathname === "/") {
					await wait(1200);
					await invoke("show_window", {
						window: {
							ScreenshotEditor: {
								path: "/private/tmp/jianku-alpha30-fixtures/screenshot.jks/original.png",
							},
						},
					});
					return;
				}
				if (location.pathname !== "/screenshot-editor") return;
				await wait(2800);
				const instance = await invoke("create_screenshot_editor_instance");
				const { background, annotations } = instance.config;
				if (
					background.inset !== 100 ||
					background.insetStyle?.color.join() !== "20,60,90" ||
					background.insetStyle?.opacity !== 100 ||
					Math.abs(annotations[0].x - 381.25) > 0.01 ||
					Math.abs(annotations[0].width - 135) > 0.01
				) {
					throw new Error(
						"Saved screenshot configuration or annotation geometry changed",
					);
				}
				const png = await invoke("render_screenshot_for_export");
				if (png.slice(0, 4).join() !== "137,80,78,71") {
					throw new Error("Reopened PNG export failed");
				}
				await emit({
					phase: "persisted-child-path",
					inset: background.inset,
					style: background.insetStyle,
					annotations,
					pngBytes: png.length,
				});
			})().catch((error) => emit({ phase: "error", message: String(error) })),
	);
})();
