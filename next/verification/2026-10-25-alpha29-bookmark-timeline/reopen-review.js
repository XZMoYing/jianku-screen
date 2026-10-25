(() => {
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
	const panel = () =>
		document.querySelector('[data-testid="recording-bookmarks"]');
	const names = () =>
		Array.from(panel().querySelectorAll('input[aria-label="书签名称"]')).map(
			(input) => input.value,
		);
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
				if (location.pathname === "/") {
					await wait(1000);
					await invoke("show_window", {
						window: {
							Editor: {
								project_path: "/private/tmp/jianku-alpha29-fixtures/replay.jks",
							},
						},
					});
					return;
				}
				if (location.pathname !== "/editor") return;
				await until(
					() => document.querySelector('button[aria-label="录制书签"]'),
					"editor",
				);
				await wait(700);
				document.querySelector('button[aria-label="录制书签"]').click();
				await until(panel, "bookmarks panel");
				if (sessionStorage.getItem("alpha29-recovery") !== "corrupt") {
					await until(() => names().length === 5, "persisted bookmarks");
					assert(
						names()[0] === "起点已重命名" && names()[2] === "后续名称保留",
						"Cold reopen lost bookmark edits",
					);
					assert(
						!panel().textContent.includes("撤销上次删除"),
						"Deletion undo leaked into a new session",
					);
					sessionStorage.setItem("alpha29-recovery", "corrupt");
					await emit({ phase: "cold-reopen", names: names() });
					await wait(1800);
					location.reload();
					return;
				}
				const error = await until(
					() => panel().querySelector('[role="alert"]'),
					"bookmark read error",
				);
				assert(
					error.textContent.includes("书签数据无效"),
					`Unexpected message: ${error.textContent}`,
				);
				assert(
					document.querySelector("button.bg-ed-text-1.rounded-full"),
					"Bookmark corruption removed editor playback controls",
				);
				await emit({ phase: "corrupt-visible", message: error.textContent });
				for (let i = 0; i < 40; i++) {
					await wait(250);
					const retry = Array.from(panel().querySelectorAll("button")).find(
						(button) => button.textContent.trim() === "重新读取",
					);
					if (retry && !retry.disabled) retry.click();
					if (names().length === 5) break;
				}
				assert(names().length === 5, "Retry did not recover the bookmark list");
				assert(
					document.querySelector('[data-testid="bookmark-track"]'),
					"Retry did not recover timeline markers",
				);
				sessionStorage.removeItem("alpha29-recovery");
				await emit({ phase: "recovered", names: names() });
				await emit({ phase: "complete" });
			})().catch((error) => emit({ phase: "fatal", message: String(error) })),
	);
})();
