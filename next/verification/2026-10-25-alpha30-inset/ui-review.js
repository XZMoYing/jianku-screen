(() => {
	const invoke = (command, args = {}, options) =>
		window.__TAURI_INTERNALS__.invoke(command, args, options);
	const emit = (payload) =>
		invoke("plugin:event|emit", {
			event: "jianku-ui-review",
			payload: { route: location.pathname, ...payload },
		});
	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const assert = (value, message) => {
		if (!value) throw new Error(message);
	};
	const until = async (read, label) => {
		for (let i = 0; i < 120; i++) {
			const result = read();
			if (result) return result;
			await wait(250);
		}
		throw new Error(`Timed out: ${label}`);
	};
	const field = (name, selector, root = document) => {
		const label = Array.from(root.querySelectorAll("span")).find(
			(node) => node.textContent.trim() === name,
		);
		for (let row = label?.parentElement; row; row = row.parentElement) {
			const control = row.querySelector(selector);
			if (control) return control;
		}
		return null;
	};
	const slide = async (name, key, root = document) => {
		const control = await until(
			() => field(name, '[role="slider"]', root),
			name,
		);
		control.scrollIntoView({ block: "nearest" });
		control.focus();
		control.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
		control.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
		control.blur();
		await wait(1400);
		return Number(control.getAttribute("aria-valuenow"));
	};
	const color = async (value, root = document) => {
		const input = field("内框颜色", 'input[type="color"]', root);
		assert(input, "Inset color control missing");
		input.value = value;
		input.dispatchEvent(new Event("change", { bubbles: true }));
		await wait(1400);
	};
	const root = "/private/tmp/jianku-alpha30-fixtures/";
	const key = (shiftKey = false) =>
		(document.activeElement ?? document.body).dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "z",
				metaKey: true,
				shiftKey,
				bubbles: true,
			}),
		);
	window.addEventListener(
		"DOMContentLoaded",
		() =>
			void (async () => {
				if (location.pathname === "/") {
					const controls = await until(
						() => document.querySelector('[data-testid="capture-appearance"]'),
						"home appearance",
					);
					await wait(1500);
					const original = await invoke("get_capture_style");
					try {
						Array.from(controls.querySelectorAll("button"))
							.find((node) => node.textContent.trim() === "布局")
							.click();
						await slide("内边距", "End", controls);
						await color("#143c5a", controls);
						await slide("内框不透明度", "End", controls);
						const styled = (await invoke("get_capture_style")).config
							.background;
						assert(styled.inset === 100, "Home width did not persist");
						assert(
							styled.insetStyle.opacity === 100,
							"Home opacity did not persist",
						);
						assert(
							styled.insetStyle.color.join() === "20,60,90",
							"Home color did not persist",
						);
						await slide("内边距", "Home", controls);
						assert(
							(await invoke("get_capture_style")).config.background.inset === 0,
						);
						await emit({
							phase: "home",
							inset: styled.inset,
							style: styled.insetStyle,
						});
					} finally {
						await invoke("set_capture_style", { style: original });
					}
					await invoke("show_window", {
						window: { Editor: { project_path: `${root}editor.jks` } },
					});
					return;
				}
				if (location.pathname === "/editor") {
					await until(() => field("内边距", '[role="slider"]'), "editor inset");
					await slide("内边距", "End");
					await color("#143c5a");
					await slide("内框不透明度", "End");
					await emit({
						phase: "editor-controls",
						width: 100,
						color: "#143c5a",
						opacity: 100,
					});
					const play = document.querySelector(
						"button.bg-ed-text-1.rounded-full",
					);
					assert(play, "Play control missing");
					play.click();
					await wait(2500);
					play.click();
					await emit({ phase: "editor-playback", completed: true });
					await invoke("show_window", {
						window: { ScreenshotEditor: { path: `${root}screenshot.jks` } },
					});
					return;
				}
				if (location.pathname !== "/screenshot-editor") return;
				await until(
					() => document.querySelector("canvas"),
					"screenshot canvas",
				);
				await wait(1800);
				const read = async () =>
					(await invoke("create_screenshot_editor_instance")).config;
				const before = await read();
				window.dispatchEvent(
					new KeyboardEvent("keydown", { key: "p", bubbles: true }),
				);
				await slide("内边距", "End");
				const inset = await read();
				assert(
					inset.background.inset === 100,
					"Screenshot inset did not update",
				);
				assert(
					inset.annotations[0].width < before.annotations[0].width,
					"Screenshot annotation did not follow the video",
				);
				key();
				await wait(1500);
				const undone = await read();
				await emit({
					phase: "screenshot-history",
					before: before.background.inset,
					changed: inset.background.inset,
					undone: undone.background.inset,
				});
				assert(
					undone.background.inset === 0,
					"Screenshot undo did not restore inset",
				);
				assert(
					Math.abs(undone.annotations[0].x - before.annotations[0].x) < 0.01,
					"Screenshot undo remapped restored annotation twice",
				);
				key(true);
				await wait(1500);
				const redone = await read();
				assert(redone.background.inset === 100, "Screenshot redo failed");
				assert(
					Math.abs(redone.annotations[0].width - inset.annotations[0].width) <
						0.01,
					"Screenshot redo changed annotation geometry",
				);
				const focused = field("内边距", '[role="slider"]');
				focused.focus();
				focused.dispatchEvent(
					new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
				);
				key();
				await wait(1500);
				assert(
					(await read()).background.inset === 100,
					"Undo while a keyboard slider is still focused failed",
				);
				focused.blur();
				await emit({ phase: "focused-slider-undo", completed: true });
				const beforePadding = await read();
				await slide("留白", "End");
				assert(
					(await read()).background.padding === 100,
					"Padding did not update",
				);
				key();
				await wait(1500);
				const restoredPadding = await read();
				await emit({
					phase: "padding-history",
					before: beforePadding.annotations,
					after: restoredPadding.annotations,
				});
				assert(
					restoredPadding.background.padding ===
						beforePadding.background.padding,
					"Padding undo did not restore project settings",
				);
				assert(
					Math.abs(
						restoredPadding.annotations[0].x - beforePadding.annotations[0].x,
					) < 0.01,
					"Padding undo scaled restored annotations again when a new frame arrived",
				);
				await emit({ phase: "resized-canvas-undo", completed: true });
				await color("#143c5a");
				await slide("内框不透明度", "End");
				const png = await invoke("render_screenshot_for_export");
				assert(png.slice(0, 4).join() === "137,80,78,71", "PNG export failed");
				await invoke("plugin:fs|write_file", new Uint8Array(png), {
					headers: {
						path: encodeURIComponent(
							"/Users/moyingxz/Documents/Zzx/05_项目开发/Jianku Screen Next/next/verification/2026-10-25-alpha30-inset/screenshot-render.png",
						),
						options: JSON.stringify({ create: true }),
					},
				});
				await emit({
					phase: "screenshot-undo-export",
					before: before.annotations,
					inset: inset.annotations,
					undone: undone.annotations,
					redone: redone.annotations,
					pngBytes: png.length,
				});
				await emit({ phase: "complete" });
			})().catch((error) =>
				emit({ phase: "error", message: String(error), stack: error.stack }),
			),
	);
})();
