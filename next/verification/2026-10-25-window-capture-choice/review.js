(() => {
	const invoke = (command, args = {}) =>
		window.__TAURI_INTERNALS__.invoke(command, args);
	const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const send = (phase, value = {}) =>
		invoke("plugin:event|emit", {
			event: "jianku-ui-review",
			payload: { phase, route: location.pathname, ...value },
		});
	const until = async (read) => {
		for (let attempt = 0; attempt < 150; attempt++) {
			const value = await read();
			if (value) return value;
			await sleep(200);
		}
		throw new Error("Window capture verification timed out");
	};
	addEventListener("DOMContentLoaded", () => {
		if (location.pathname !== "/") return;
		void run().catch((error) => send("failed", { error: String(error) }));
	});
	async function run() {
		await sleep(4000);
		if ((await invoke("get_current_recording"))[0])
			throw new Error("A user recording is already active");
		const rid = await invoke("plugin:store|load", { path: "store" });
		const [original] = await invoke("plugin:store|get", {
			rid,
			key: "general_settings",
		});
		const save = async (value) => {
			await invoke("plugin:store|set", {
				rid,
				key: "general_settings",
				value,
			});
			await invoke("plugin:store|save", { rid });
			await sleep(500);
		};
		const [inputs] = await invoke("plugin:store|get", {
			rid,
			key: "recording_settings",
		});
		await invoke("set_mic_input", { label: null });
		await invoke("set_camera_input", { id: null, skipCameraWindow: true });
		let ownedRecording = false;
		const sample = async (label, isolated) => {
			await sleep(600);
			const bookmark = await invoke("add_recording_bookmark");
			await send("capture-sample", { label, isolated, bookmark });
		};
		try {
			await save({
				...original,
				recordingCountdown: 0,
				isolateWindowCapture: false,
			});
			for (const label of ["录屏", "电脑屏幕"]) {
				Array.from(document.querySelectorAll("button"))
					.find((button) => button.textContent.trim() === label)
					?.click();
			}
			const windowButton = await until(() =>
				document.querySelector('button[aria-label="选择窗口"]'),
			);
			windowButton.click();
			const toggle = await until(() =>
				document.querySelector('[aria-label="过滤其他窗口"] input'),
			);
			if (toggle.checked)
				throw new Error("Window isolation must default to off");
			toggle.click();
			await until(async () => {
				const [settings] = await invoke("plugin:store|get", {
					rid,
					key: "general_settings",
				});
				return settings.isolateWindowCapture;
			});
			await send("toggle-ui", { saved: true });
			for (const isolated of [false, true]) {
				await save({
					...original,
					recordingCountdown: 0,
					isolateWindowCapture: isolated,
				});
				await send("fixture-command", { action: "prepare", isolated });
				await sleep(700);
				const windows = await invoke("list_capture_windows");
				const fixture = windows.find(
					(item) => item.name === "Jianku Window Capture Fixture",
				);
				if (!fixture) throw new Error("Synthetic fixture window missing");
				await invoke("start_recording", {
					inputs: {
						capture_target: { variant: "window", id: fixture.id },
						mode: "studio",
						capture_system_audio: false,
					},
				});
				ownedRecording = true;
				await send("recording-started", { isolated });
				await sample("initial", isolated);
				await sleep(2000);
				await send("fixture-command", { action: "cover", isolated });
				await sample("cover", isolated);
				await sleep(2500);
				await send("fixture-command", { action: "uncover", isolated });
				await sample("uncover", isolated);
				await sleep(1500);
				if (isolated) {
					await send("fixture-command", { action: "move", isolated });
					await sample("move", isolated);
					await sleep(2000);
					await send("fixture-command", { action: "resize", isolated });
					await sample("resize", isolated);
					await sleep(2000);
					await invoke("pause_recording");
					await sleep(600);
					await invoke("resume_recording");
					await sample("resumed", isolated);
					await sleep(2000);
				}
				await invoke("stop_recording");
				ownedRecording = false;
				await send("recording-completed", { isolated });
			}
		} finally {
			if (ownedRecording) await invoke("stop_recording");
			await save(original);
			await invoke("set_mic_input", { label: inputs?.micName ?? null });
			await invoke("set_camera_input", {
				id: inputs?.cameraId ?? null,
				skipCameraWindow: true,
			});
		}
		await send("completed", { settingsRestored: true });
	}
})();
