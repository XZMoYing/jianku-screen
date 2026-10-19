(() => {
	const invoke = (command, args = {}) =>
		window.__TAURI_INTERNALS__.invoke(command, args);
	const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const send = (phase, value = {}) =>
		invoke("plugin:event|emit", {
			event: "jianku-ui-review",
			payload: { route: location.pathname, phase, ...value },
		});
	const assert = (ok, message) => {
		if (!ok) throw new Error(message);
	};
	const until = async (read, timeout = 30000) => {
		const start = performance.now();
		while (performance.now() - start < timeout) {
			const value = await read();
			if (value) return value;
			await sleep(200);
		}
		throw new Error("Verification timed out");
	};
	addEventListener(
		"error",
		(event) => void send("error", { message: event.message }),
	);
	addEventListener(
		"unhandledrejection",
		(event) => void send("rejection", { message: String(event.reason) }),
	);
	addEventListener(
		"DOMContentLoaded",
		() =>
			void run().catch((error) => send("failed", { message: String(error) })),
	);
	async function run() {
		if (
			location.pathname.startsWith("/settings") &&
			localStorage.getItem("jianku-alpha26-review") === "click-bookmark"
		) {
			localStorage.setItem("jianku-alpha26-review", "recording-test");
			await invoke("stop_recording");
			await send("recovered-owned-test-recording");
			return;
		}
		if (location.pathname === "/settings/hotkeys") {
			const rowFor = async (label) =>
				until(
					() =>
						Array.from(document.querySelectorAll("p")).find(
							(element) => element.textContent.trim() === label,
						)?.parentElement,
				);
			const enter = async (row) => {
				row.querySelector("button").click();
				await sleep(100);
				window.dispatchEvent(
					new KeyboardEvent("keydown", {
						code: "F13",
						key: "F13",
						ctrlKey: true,
						metaKey: true,
						altKey: true,
						shiftKey: true,
						bubbles: true,
					}),
				);
				await until(() => row.querySelectorAll("button").length === 2);
			};
			const bookmark = await rowFor("添加录制书签");
			const curtain = await rowFor("遮盖/恢复演示画面");
			await enter(bookmark);
			bookmark.querySelector("button").click();
			await until(
				() =>
					bookmark.querySelectorAll("button").length === 1 &&
					bookmark.textContent.includes("F13"),
			);
			await enter(curtain);
			curtain.querySelector("button").click();
			await until(() => document.body.textContent.includes("已分配给其他操作"));
			assert(
				bookmark.textContent.includes("F13") &&
					!curtain.textContent.includes("F13"),
				"Rejected shortcut must revert the UI",
			);
			bookmark.querySelector("button").click();
			await until(() => bookmark.querySelectorAll("button").length === 2);
			bookmark.querySelectorAll("button")[1].click();
			await until(
				() =>
					bookmark.querySelectorAll("button").length === 1 &&
					!bookmark.textContent.includes("F13"),
			);
			await send("shortcut-settings-ui", {
				saved: true,
				rejectedConflict: true,
				reverted: true,
				cleared: true,
			});
			return;
		}

		if (location.pathname === "/presentation-output") {
			let last;
			const timer = setInterval(() => {
				const visible = !!document.querySelector(
					'[data-testid="presentation-curtain"]',
				);
				if (visible !== last) {
					last = visible;
					void send("curtain-visible", { visible });
				}
			}, 100);
			addEventListener("beforeunload", () => clearInterval(timer));
			return;
		}
		if (location.pathname === "/in-progress-recording") {
			await until(
				() =>
					localStorage.getItem("jianku-alpha26-review") === "click-bookmark",
				120000,
			);
			const button = await until(() => {
				const element = document.querySelector('button[aria-label="添加书签"]');
				return element && !element.disabled && element;
			});
			button.click();
			await until(() => button.classList.contains("text-green-10"));
			localStorage.setItem("jianku-alpha26-review", "bookmark-clicked");
			await send("bookmark-button", { confirmed: true });
			return;
		}
		if (location.pathname === "/editor") {
			const readyButton = await until(() =>
				document.querySelector('button[aria-label="录制书签"]'),
			);
			const projectPath = await invoke("get_editor_project_path");

			if (
				projectPath.includes("Jianku Runtime Fixture") &&
				projectPath.includes("08.02 PM") &&
				localStorage.getItem("jianku-alpha26-review") !== "recording-test"
			) {
				readyButton.click();
				const first = await until(() =>
					document.querySelector('[data-testid="recording-bookmarks"] input'),
				);
				assert(
					first.value === "验证书签：开始讲解",
					"Cold reopen lost the saved bookmark name",
				);
				assert(
					document.querySelectorAll('[data-testid="recording-bookmarks"] input')
						.length === 3,
					"Cold reopen lost bookmark deletion",
				);
				await send("cold-reopen-bookmarks", {
					nameRetained: true,
					deletionRetained: true,
					count: 3,
				});
				return;
			}
			if (
				projectPath.includes("Jianku Runtime Fixture") &&
				projectPath.includes("07.54 PM")
			) {
				readyButton.click();
				const jump = await until(() =>
					Array.from(
						document.querySelectorAll(
							'[data-testid="recording-bookmarks"] button',
						),
					).find(
						(element) =>
							!element.disabled &&
							/^\d+:\d+\.\d$/.test(element.textContent.trim()),
					),
				);
				jump.click();
				await until(
					() => !document.querySelector('[data-testid="recording-bookmarks"]'),
				);
				const samples = [];
				for (let count = 0; count < 3; count++) {
					await sleep(1000);
					samples.push(
						Array.from(document.querySelectorAll("span.tabular-nums"))
							.map((element) => element.textContent.trim())
							.filter((text) => text.includes(":")),
					);
				}
				await send("stable-bookmark-jump", { samples });
				return;
			}
			if (localStorage.getItem("jianku-alpha26-review") !== "recording-test")
				return;
			const button = await until(() =>
				document.querySelector('button[aria-label="录制书签"]'),
			);
			const instance = await invoke("create_editor_instance");
			let bookmarks = await invoke("get_recording_bookmarks", {
				timeline: instance.savedProjectConfig.timeline,
			});
			assert(
				bookmarks.length === 4,
				`Expected four bookmarks, got ${bookmarks.length}`,
			);
			assert(
				bookmarks[1].bookmark.time === bookmarks[2].bookmark.time,
				"Paused bookmarks must keep the same media time",
			);
			assert(
				bookmarks[3].bookmark.recordingSegment === 1,
				"Resume must use the next source segment",
			);
			await send("bookmark-projection", {
				points: bookmarks.map((item) => ({
					segment: item.bookmark.recordingSegment,
					time: item.bookmark.time,
					positions: item.positions,
				})),
			});
			assert(
				bookmarks.every((item) => item.positions.length === 1),
				"Every captured bookmark must resolve to a visible moment",
			);
			button.click();
			const list = await until(() =>
				document.querySelector('[data-testid="recording-bookmarks"]'),
			);
			await until(() => list.querySelectorAll("input").length === 4);
			const name = list.querySelector("input");
			name.focus();
			name.value = "验证书签：开始讲解";
			name.blur();
			await until(async () => {
				bookmarks = await invoke("get_recording_bookmarks", {
					timeline: instance.savedProjectConfig.timeline,
				});
				return bookmarks[0].bookmark.label === "验证书签：开始讲解";
			});
			const jump = await until(() =>
				Array.from(list.querySelectorAll("button")).find(
					(element) =>
						!element.disabled &&
						/^\d+:\d+\.\d$/.test(element.textContent.trim()),
				),
			);
			assert(jump, "Bookmark jump control is missing");
			jump.click();
			await until(
				() => !document.querySelector('[data-testid="recording-bookmarks"]'),
			);
			await sleep(500);
			const times = Array.from(document.querySelectorAll("span.tabular-nums"))
				.map((element) => element.textContent.trim())
				.filter((text) => text.includes(":"));
			button.click();
			const reopened = await until(() =>
				document.querySelector('[data-testid="recording-bookmarks"] input'),
			);
			assert(
				reopened.value === "验证书签：开始讲解",
				"Bookmark name was not retained",
			);
			const deletes = document.querySelectorAll(
				'button[aria-label="删除书签"]',
			);
			deletes[deletes.length - 1].click();
			await until(
				async () =>
					(
						await invoke("get_recording_bookmarks", {
							timeline: instance.savedProjectConfig.timeline,
						})
					).length === 3,
			);
			await send("editor-bookmarks", {
				projectPath: instance.path,
				duration: instance.recordingDuration,
				times,
				sourceTimes: bookmarks.map((item) => item.bookmark.time),
				sourceSegments: bookmarks.map((item) => item.bookmark.recordingSegment),
				positions: bookmarks.map((item) => item.positions),
				rename: true,
				jump: true,
				delete: true,
			});
			localStorage.removeItem("jianku-alpha26-review");
			return;
		}
		if (location.pathname !== "/") return;
		localStorage.removeItem("jianku-alpha26-review");
		await sleep(4000);
		const permissions = await invoke("do_permissions_check", {
			initialCheck: true,
		});
		await send("permissions", permissions);
		assert(
			["granted", "notNeeded"].includes(permissions.screenRecording),
			"Screen recording permission is required",
		);
		assert(
			["granted", "notNeeded"].includes(permissions.accessibility),
			"Accessibility permission is required",
		);
		assert(
			!(await invoke("get_current_recording"))[0],
			"A user recording is already active",
		);
		const binding = {
			code: "F13",
			ctrl: true,
			meta: true,
			alt: true,
			shift: true,
		};
		await invoke("set_hotkey", {
			action: "addRecordingBookmark",
			hotkey: binding,
		});
		let conflict = false;
		try {
			await invoke("set_hotkey", {
				action: "togglePresentationCurtain",
				hotkey: binding,
			});
		} catch {
			conflict = true;
		} finally {
			await invoke("set_hotkey", {
				action: "addRecordingBookmark",
				hotkey: null,
			});
		}
		assert(conflict, "Conflicting shortcuts must be rejected");
		await send("shortcut-conflict", { rejected: conflict });
		const setup = await invoke("get_presentation_setup");
		const original = structuredClone(setup.options);
		let ownedPresentation = false;
		let socket;
		let latest;
		try {
			const options = structuredClone(original);
			options.outputMonitor = null;
			options.sourceId = setup.displays[0].id;
			options.outputResolution = 1280;
			const initial = await invoke("start_presentation", { options });
			ownedPresentation = true;
			socket = new WebSocket(`ws://127.0.0.1:${initial.wsPort}/`);
			socket.binaryType = "arraybuffer";
			socket.onmessage = (event) => {
				const bytes = new Uint8Array(event.data);
				const view = new DataView(event.data);
				let solid = true;
				for (let sample = 0; sample < 1024; sample++) {
					const position =
						Math.floor((sample * (bytes.length - 24)) / 1024 / 4) * 4;
					if (
						bytes[position] !== 242 ||
						bytes[position + 1] !== 241 ||
						bytes[position + 2] !== 237 ||
						bytes[position + 3] !== 255
					) {
						solid = false;
						break;
					}
				}
				latest = {
					solid,
					width: view.getUint32(bytes.length - 16, true),
					height: view.getUint32(bytes.length - 20, true),
				};
			};
			await until(() => latest && !latest.solid);
			const cover = await until(() =>
				Array.from(document.querySelectorAll("button")).find((element) =>
					element.textContent.includes("遮盖演示画面"),
				),
			);
			cover.click();
			await until(
				async () =>
					(await invoke("get_presentation_status")).curtain && latest?.solid,
			);
			await sleep(1500);
			assert(latest.solid, "Static source must remain covered");
			for (let count = 0; count < 10; count++)
				await invoke("toggle_presentation_curtain");
			assert(
				(await invoke("get_presentation_status")).curtain,
				"Rapid toggles lost their order",
			);
			const updated = await invoke("update_presentation", {
				options: { ...options, outputResolution: 1920 },
			});
			await until(() => latest?.solid && latest.width === updated.outputWidth);
			const resume = await until(() =>
				Array.from(document.querySelectorAll("button")).find((element) =>
					element.textContent.includes("恢复演示画面"),
				),
			);
			resume.click();
			await until(
				async () =>
					!(await invoke("get_presentation_status")).curtain &&
					latest &&
					!latest.solid,
			);
			const resumed = await invoke("get_presentation_status");
			await invoke("toggle_presentation_curtain");
			await invoke("stop_presentation");
			const stopped = await invoke("get_presentation_status");
			const restarted = await invoke("start_presentation", { options });
			assert(
				!stopped.active &&
					!stopped.curtain &&
					restarted.active &&
					!restarted.curtain,
				"Curtain must reset for a new session",
			);
			await send("presentation-curtain", {
				staticSource: true,
				rapidToggles: 10,
				resize: true,
				resumed,
				stopped,
				restarted,
				rawFramesSaved: false,
			});
		} finally {
			socket?.close();
			if (ownedPresentation) await invoke("stop_presentation");
			await invoke("update_presentation", { options: original });
		}
		const windows = await invoke("list_capture_windows");
		const fixture = windows.find(
			(element) => element.name === "Jianku Runtime Fixture",
		);
		assert(fixture, "Synthetic recording window is missing");
		localStorage.setItem("jianku-alpha26-review", "recording-test");
		await invoke("start_recording", {
			inputs: {
				capture_target: { variant: "window", id: fixture.id },
				mode: "studio",
				capture_system_audio: false,
			},
		});
		let first, paused1, paused2;
		try {
			await sleep(2000);
			first = await invoke("add_recording_bookmark");
			await invoke("pause_recording");
			paused1 = await invoke("add_recording_bookmark");
			await sleep(2000);
			paused2 = await invoke("add_recording_bookmark");
			assert(
				paused1.time === paused2.time,
				"Pauses must not advance bookmark time",
			);
			await invoke("resume_recording");
			await sleep(2000);
			localStorage.setItem("jianku-alpha26-review", "click-bookmark");
			await until(
				() =>
					localStorage.getItem("jianku-alpha26-review") === "bookmark-clicked",
			);
			localStorage.setItem("jianku-alpha26-review", "recording-test");
		} finally {
			localStorage.setItem("jianku-alpha26-review", "recording-test");
			await invoke("stop_recording");
		}

		await send("recording-bookmarks", {
			first: first.time,
			paused1: paused1.time,
			paused2: paused2.time,
			pauseExcluded: true,
			syntheticWindow: true,
		});
	}
})();
