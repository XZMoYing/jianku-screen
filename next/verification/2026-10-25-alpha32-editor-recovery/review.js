(() => {
	const mode = window.JIANKU_RECOVERY_REVIEW_MODE;
	const invoke = (command, args = {}) =>
		window.__TAURI_INTERNALS__.invoke(command, args);
	const emit = (payload) =>
		invoke("plugin:event|emit", {
			event: "jianku-ui-review",
			payload: { route: location.pathname, mode, ...payload },
		});
	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const originalFetch = window.fetch;
	const syntheticError = (reason) =>
		new Response(JSON.stringify(reason), {
			headers: {
				"Content-Type": "application/json",
				"Tauri-Response": "error",
			},
		});
	let metadataHeld = false;
	let titleFailure = mode === "save-failure";
	window.fetch = function (input, ...rest) {
		const url = String(input);
		if (mode === "loading-quit" && url.endsWith("/create_editor_instance")) {
			void emit({ phase: "creation-held" });
			return new Promise(() => {});
		}
		if (mode === "route-error" && url.endsWith("/get_editor_project_path")) {
			return Promise.resolve(
				syntheticError("Injected project-path lookup failure"),
			);
		}
		if (
			mode === "metadata" &&
			!sessionStorage.getItem("jianku:metadata-restored") &&
			!metadataHeld &&
			url.endsWith("/get_recording_meta_by_path")
		) {
			metadataHeld = true;
			return emit({ phase: "metadata-held" })
				.then(() => wait(1200))
				.then(() => originalFetch.call(this, input, ...rest));
		}
		if (titleFailure && url.endsWith("/set_pretty_name")) {
			void emit({ phase: "save-rejected" });
			setTimeout(() => {
				titleFailure = false;
				void emit({ phase: "save-unblocked" });
			}, 3500);
			return Promise.resolve(syntheticError("Injected read-only destination"));
		}
		return originalFetch.call(this, input, ...rest);
	};

	window.addEventListener("DOMContentLoaded", () => {
		void (async () => {
			if (location.pathname !== "/editor") {
				if (location.pathname === "/") {
					await wait(300);
					await emit({ phase: "home-ready" });
				}
				return;
			}
			let reportedError = false;
			for (let tick = 0; tick < 300; tick++) {
				const error = document.querySelector("[data-editor-error]");
				if (error && !reportedError) {
					reportedError = true;
					await emit({
						phase: "error-ready",
						heading: error.querySelector("h2")?.textContent,
						project: await invoke("get_editor_project_path").catch(() => null),
						actions: Array.from(
							error.querySelectorAll("[data-editor-error-action]"),
						).map((node) => node.getAttribute("data-editor-error-action")),
					});
					if (mode === "close" || mode === "home") {
						await emit({ phase: "action-clicked", action: mode });
						error.querySelector(`[data-editor-error-action="${mode}"]`).click();
						return;
					}
					if (mode === "reload" || mode === "metadata") {
						await emit({ phase: "restore-required" });
						await wait(1800);
						if (mode === "metadata")
							sessionStorage.setItem("jianku:metadata-restored", "1");
						error.querySelector('[data-editor-error-action="retry"]').click();
						return;
					}
				}
				const play = document.querySelector(
					"button.bg-ed-text-1[aria-pressed]",
				);
				if (play) {
					const project = await invoke("get_editor_project_path");
					if (mode === "home" || mode === "save-failure") {
						const input = document.querySelector(".jk-editor-header input");
						if (!input) throw new Error("Missing title input");
						input.focus();
						input.value = "异常工程共存验收";
						input.dispatchEvent(new InputEvent("input", { bubbles: true }));
					}
					await emit({ phase: "editor-ready", project });
					return;
				}
				await wait(100);
			}
			throw new Error("Review did not reach an editor or error state");
		})().catch(
			(error) => void emit({ phase: "review-error", message: String(error) }),
		);
	});
})();
