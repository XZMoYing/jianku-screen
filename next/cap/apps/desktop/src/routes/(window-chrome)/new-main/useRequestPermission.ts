import { useQueryClient } from "@tanstack/solid-query";
import { TauriEvent, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow, type Window } from "@tauri-apps/api/window";
import { type as ostype } from "@tauri-apps/plugin-os";
import { generalSettingsStore } from "~/store";
import { devicesSnapshot } from "~/utils/devices";
import { requestAndVerifyPermission } from "~/utils/os-permissions";
import { commands, type OSPermissionStatus } from "~/utils/tauri";
import { enqueueWindowLevelUpdate } from "~/utils/window-level";

type SettingsHandoff = { revision: number; wasUnfocused: boolean };

let permissionWindow: PermissionWindow | undefined;

class PermissionWindow {
	private originalAlwaysOnTop = false;
	private pending = 0;
	private disposed = false;
	private revision = 0;
	private focused: boolean | undefined;
	private lastBlur = -1;
	private lastFocus = -1;
	private settingsHandoff: SettingsHandoff | undefined;
	private unlisten: UnlistenFn[] = [];
	private restoring: Promise<void> | undefined;
	private ready: Promise<void>;

	constructor(
		private window: Window,
		private refreshDevices: () => Promise<unknown>,
	) {
		this.ready = this.listen();
	}

	private current() {
		return !this.disposed && permissionWindow === this;
	}

	private dispose() {
		this.disposed = true;
		if (permissionWindow === this) permissionWindow = undefined;
		for (const unlisten of this.unlisten.splice(0)) unlisten();
	}

	private addListener(unlisten: UnlistenFn) {
		if (this.disposed) unlisten();
		else this.unlisten.push(unlisten);
	}

	private async listen() {
		this.addListener(
			await this.window.once(TauriEvent.WINDOW_DESTROYED, () => this.dispose()),
		);
		if (this.disposed) return;
		this.addListener(
			await this.window.onFocusChanged(({ payload: focused }) => {
				this.revision += 1;
				this.focused = focused;
				if (focused) this.lastFocus = this.revision;
				else this.lastBlur = this.revision;
				void this.restore().catch((error) => {
					console.error("Failed to restore permission window:", error);
				});
			}),
		);
		if (this.disposed) return;
		this.originalAlwaysOnTop = await enqueueWindowLevelUpdate(() =>
			this.window.isAlwaysOnTop(),
		);
		const revision = this.revision;
		const focused = await this.window.isFocused();
		if (this.revision === revision) this.focused = focused;
	}

	private canRestore() {
		return (
			this.current() &&
			this.pending === 0 &&
			(this.settingsHandoff === undefined ||
				(this.lastFocus > this.settingsHandoff.revision &&
					(this.settingsHandoff.wasUnfocused ||
						this.lastBlur > this.settingsHandoff.revision) &&
					this.lastFocus > this.lastBlur))
		);
	}

	private updateWindowLevel(mode: "lower" | "restore") {
		const restoring = mode === "restore";
		return enqueueWindowLevelUpdate(async () => {
			if (!this.current() || (restoring && !this.canRestore())) return;
			const value = restoring
				? this.window.label === "main"
					? ((await generalSettingsStore.get())?.mainWindowAlwaysOnTop ?? false)
					: this.originalAlwaysOnTop
				: false;
			if (!this.current() || (restoring && !this.canRestore())) return;
			await this.window.setAlwaysOnTop(value);
		});
	}

	async acquire() {
		this.pending += 1;
		try {
			await this.ready;
			await this.updateWindowLevel("lower");
			if (!this.current()) throw new Error("Permission window was closed");
		} catch (error) {
			this.pending -= 1;
			this.dispose();
			throw error;
		}
	}

	beginSettingsHandoff(): SettingsHandoff {
		return { revision: this.revision, wasUnfocused: this.focused === false };
	}

	async release(settingsHandoff: SettingsHandoff | undefined) {
		this.pending -= 1;
		if (
			settingsHandoff !== undefined &&
			settingsHandoff.revision >= (this.settingsHandoff?.revision ?? -1)
		) {
			this.settingsHandoff = settingsHandoff;
		}
		await this.restore();
	}

	private async restore() {
		if (!this.canRestore()) return;
		if (this.restoring) return this.restoring;
		this.restoring = this.updateWindowLevel("restore")
			.then(async () => {
				if (!this.canRestore()) return;
				const returnedFromSettings = this.settingsHandoff !== undefined;
				this.dispose();
				if (returnedFromSettings) await this.refreshDevices();
			})
			.finally(() => {
				this.restoring = undefined;
			});
		return this.restoring;
	}
}

export default function useRequestPermission() {
	const queryClient = useQueryClient();
	const refreshDevices = () =>
		queryClient.fetchQuery({ ...devicesSnapshot, staleTime: 0 });

	async function requestPermission(
		type: "camera" | "microphone",
		currentStatus?: OSPermissionStatus,
	) {
		try {
			const window = getCurrentWindow();
			if (ostype() === "macos") {
				permissionWindow ??= new PermissionWindow(window, refreshDevices);
				const session = permissionWindow;
				await session.acquire();
				let settingsHandoff: SettingsHandoff | undefined;
				try {
					const result = await requestAndVerifyPermission(
						{
							requestPermission: commands.requestPermission,
							doPermissionsCheck: commands.doPermissionsCheck,
							openPermissionSettings: async (permission) => {
								const handoff = session.beginSettingsHandoff();
								await commands.openPermissionSettings(permission);
								settingsHandoff = handoff;
							},
						},
						type,
						currentStatus,
					);
					if (!result.openedSettings) settingsHandoff = undefined;
				} finally {
					await session.release(settingsHandoff);
				}
			} else {
				const originalAlwaysOnTop = await enqueueWindowLevelUpdate(async () => {
					const value = await window.isAlwaysOnTop();
					await window.setAlwaysOnTop(false);
					return value;
				});
				try {
					await requestAndVerifyPermission(commands, type, currentStatus);
				} finally {
					await enqueueWindowLevelUpdate(async () => {
						const value =
							window.label === "main"
								? ((await generalSettingsStore.get())?.mainWindowAlwaysOnTop ??
									false)
								: originalAlwaysOnTop;
						await window.setAlwaysOnTop(value);
					});
				}
			}
			await refreshDevices();
		} catch (error) {
			console.error(`Failed to get ${type} permission:`, error);
		}
	}

	return requestPermission;
}
