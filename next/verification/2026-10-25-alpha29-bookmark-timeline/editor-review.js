(() => {
	let frames = 0;
	const NativeSocket = window.WebSocket;
	window.WebSocket = class extends NativeSocket {
		constructor(...args) {
			super(...args);
			this.addEventListener("message", () => frames++);
		}
	};
	const invoke = (command, args = {}) =>
		window.__TAURI_INTERNALS__.invoke(command, args);
	const emit = (value) =>
		invoke("plugin:event|emit", {
			event: "jianku-ui-review",
			payload: { route: location.pathname, ...value },
		}).catch(() => {});
	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const until = async (read, description) => {
		for (let i = 0; i < 120; i++) {
			const value = read();
			if (value) return value;
			await wait(100);
		}
		throw Error(`Missing ${description}`);
	};
	const assert = (condition, message) => {
		if (!condition) throw Error(message);
	};
	const clickText = (text, root = document) => {
		const button = Array.from(root.querySelectorAll("button")).find(
			(node) => node.textContent.trim() === text,
		);
		assert(button, `Missing button ${text}`);
		button.click();
		return button;
	};
	const panel = () =>
		document.querySelector('[data-testid="recording-bookmarks"]');
	const inputs = () =>
		Array.from(panel().querySelectorAll('input[aria-label="书签名称"]'));
	const readTime = () =>
		Array.from(document.querySelectorAll("span.tabular-nums"))
			.slice(0, 3)
			.map((node) => node.textContent);
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
				const project = "/private/tmp/jianku-alpha29-fixtures/replay.jks";
				if (location.pathname === "/") {
					await wait(1000);
					await invoke("show_window", {
						window: { Editor: { project_path: project } },
					});
					return;
				}
				if (location.pathname !== "/editor") return;
				await until(
					() => document.querySelector('[data-testid="bookmark-track"]'),
					"bookmark track",
				);
				await wait(1000);
				const track = () =>
					document.querySelector('[data-testid="bookmark-track"]');
				const markers = () =>
					Array.from(track().querySelectorAll("button[title]"));
				assert(
					document.body.textContent.includes("片段 1") &&
						document.body.textContent.includes("片段 2"),
					"Dynamic source clip labels were not localized",
				);
				const initial = markers().map((node) => ({
					label: node.getAttribute("aria-label"),
					x: node.getBoundingClientRect().x,
					width: node.getBoundingClientRect().width,
				}));
				assert(
					markers().length === 4,
					`Expected four marker groups: ${JSON.stringify(initial)}`,
				);
				await emit({ phase: "markers", initial });
				const repeated = markers().find((node) =>
					node.title.includes("重复使用"),
				);
				repeated.click();
				await wait(900);
				assert(
					!document.querySelector('[role="dialog"]'),
					"Single marker unexpectedly opened a popover",
				);
				await emit({ phase: "single-jump", time: readTime() });
				const group = markers().find((node) => node.title.includes("相邻"));
				group.click();
				const popup = await until(
					() =>
						Array.from(document.querySelectorAll("button")).find((node) =>
							node.textContent.includes("开场"),
						),
					"cluster menu",
				);
				popup.click();
				await wait(900);
				await emit({ phase: "cluster-jump", time: readTime() });
				document.querySelector('button[aria-label="录制书签"]').click();
				await until(panel, "bookmarks panel");
				assert(inputs().length === 5, "Expected five saved bookmarks");
				assert(
					panel().textContent.includes("所在画面已被剪除"),
					"Cut bookmark hint missing",
				);
				const rename = async (index, name) => {
					const input = inputs()[index];
					input.focus();
					input.value = name;
					input.dispatchEvent(new Event("input", { bubbles: true }));
					input.blur();
					await wait(500);
				};
				await rename(0, "起点已重命名");
				const deleteAt = async (index) => {
					panel()
						.querySelectorAll('button[aria-label="删除书签"]')
						[index].click();
					await wait(500);
				};
				await deleteAt(1);
				assert(inputs().length === 4, "Delete not reflected");
				await rename(1, "后续名称保留");
				clickText("完成");
				await wait(200);
				document.querySelector('button[aria-label="录制书签"]').click();
				await until(panel, "reopened bookmarks panel");
				clickText("撤销上次删除", panel());
				await wait(500);
				assert(inputs().length === 5, "Undo did not restore bookmark");
				assert(
					inputs()[2].value === "后续名称保留",
					"Undo overwrote another edit",
				);
				assert(inputs()[1].value === "紧邻", "Undo changed record order");
				await deleteAt(0);
				await deleteAt(1);
				clickText("撤销上次删除", panel());
				await wait(300);
				clickText("撤销上次删除", panel());
				await wait(400);
				assert(
					inputs().length === 5,
					"Sequential undo did not restore all records",
				);
				for (let i = 0; i < 5; i++) await deleteAt(0);
				assert(
					!track(),
					"Empty bookmark track remained after deleting all bookmarks",
				);
				for (let i = 0; i < 5; i++) {
					clickText("撤销上次删除", panel());
					await wait(300);
				}
				assert(
					inputs().length === 5,
					"Undo after deleting all did not restore the bookmarks",
				);
				await emit({
					phase: "delete-undo",
					names: inputs().map((node) => node.value),
					markers: markers().map((node) => node.title),
				});
				clickText("完成");
				await wait(300);
				const before = frames;
				const play = document.querySelector("button.bg-ed-text-1.rounded-full");
				assert(play, "Missing playback button");
				play.click();
				await wait(1500);
				play.click();
				await wait(400);
				assert(frames - before > 10, "Playback did not deliver video frames");
				await emit({
					phase: "playback",
					transportFrames: frames - before,
					time: readTime(),
				});
				await emit({ phase: "complete" });
			})().catch((error) =>
				emit({
					phase: "fatal",
					message: String(error),
					excerpt: document.body.innerText.slice(-1600),
				}),
			),
	);
})();
