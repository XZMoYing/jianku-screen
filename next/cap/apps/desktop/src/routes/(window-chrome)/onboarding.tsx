import { Button } from "@cap/ui-solid";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import brandLogo from "~/assets/branding/logo.png";
import { generalSettingsStore } from "~/store";
import { t as localize } from "~/utils/i18n";
import {
	isPermissionGranted,
	requestAndVerifyPermission,
} from "~/utils/os-permissions";
import {
	commands,
	type OSPermission,
	type OSPermissionsCheck,
} from "~/utils/tauri";
import IconCheck from "~icons/lucide/check";
import IconShield from "~icons/lucide/shield-check";
import { WindowChromeHeader } from "./Context";

const permissions: {
	key: OSPermission;
	name: string;
	detail: string;
	optional?: boolean;
}[] = [
	{
		key: "screenRecording",
		name: "屏幕录制",
		detail: "用于录屏、截图和实时演示。授权后按系统提示重新启动应用。",
	},
	{
		key: "accessibility",
		name: "辅助功能",
		detail: "记录光标位置与点击，用于平滑光标和自动焦点跟随。",
	},
	{
		key: "microphone",
		name: "麦克风",
		detail: "录制旁白时使用，稍后也可以开启。",
		optional: true,
	},
	{
		key: "camera",
		name: "摄像头",
		detail: "需要叠加摄像画面时使用，稍后也可以开启。",
		optional: true,
	},
];
export default function OnboardingPage() {
	const [check, setCheck] = createSignal<OSPermissionsCheck>();
	const [busy, setBusy] = createSignal(false);
	const [error, setError] = createSignal("");
	let alive = true;
	let refreshing = false;
	const refresh = async () => {
		if (refreshing) return;
		refreshing = true;
		try {
			const result = await commands.doPermissionsCheck(false);
			if (alive) {
				setCheck(result);
				setError("");
			}
		} catch (e) {
			if (alive) setError(String(e));
		} finally {
			refreshing = false;
		}
	};
	const permitted = (key: OSPermission) => {
		const status = check()?.[key];
		return status ? isPermissionGranted(status) : false;
	};
	const ready = () =>
		permitted("screenRecording") && permitted("accessibility");
	const request = async (permission: OSPermission) => {
		setBusy(true);
		try {
			await requestAndVerifyPermission(
				commands,
				permission,
				check()?.[permission],
			);
			await refresh();
		} catch (e) {
			setError(String(e));
		} finally {
			if (alive) setBusy(false);
		}
	};
	const finish = async (later = false) => {
		if ((!later && !ready()) || busy()) return;
		setBusy(true);
		try {
			await generalSettingsStore.set({
				hasCompletedStartup: true,
				hasCompletedOnboarding: true,
			});
			await commands.showWindow({ Main: { init_target_mode: null } });
			await getCurrentWindow().close();
		} catch (e) {
			setError(String(e));
			setBusy(false);
		}
	};
	onMount(() => {
		void refresh();
		const timer = setInterval(() => {
			if (document.visibilityState === "visible") void refresh();
		}, 1500);
		onCleanup(() => clearInterval(timer));
	});
	onCleanup(() => {
		alive = false;
	});
	return (
		<div class="jk-onboarding">
			<WindowChromeHeader>
				<span class="jk-guide-window-name" data-tauri-drag-region>
					{localize("简库镜传 Next")}
				</span>
			</WindowChromeHeader>
			<div class="jk-guide-body">
				<div class="jk-guide-brand">
					<img src={brandLogo} alt={localize("简库镜传 Next")} />
					<span>{localize("权限与输入")}</span>
					<IconShield />
				</div>
				<div class="jk-guide-permissions">
					<For each={permissions}>
						{(permission) => (
							<div class="jk-guide-permission">
								<div>
									<span class="jk-guide-label">
										{permission.name}
										<Show when={permission.optional}>
											<small>{localize("可选")}</small>
										</Show>
									</span>
									<p>{permission.detail}</p>
								</div>
								<Button
									variant={permitted(permission.key) ? "gray" : "primary"}
									disabled={busy() || permitted(permission.key)}
									onClick={() => void request(permission.key)}
								>
									<Show when={permitted(permission.key)}>
										<IconCheck class="size-4" />
									</Show>
									{permitted(permission.key) ? "已开启" : "开启"}
								</Button>
							</div>
						)}
					</For>
				</div>
				<div class="jk-guide-hint">
					若系统中已开启但仍提示未授权，请在系统设置中关闭再开启该权限，然后重新启动应用。
				</div>
				<Show when={error()}>
					<p role="alert" class="jk-guide-error">
						{error()}
					</p>
				</Show>
			</div>
			<footer class="jk-guide-footer">
				<button
					type="button"
					class="jk-tonal-button"
					onClick={() => void refresh()}
					disabled={busy()}
				>
					{localize("重新检测")}
				</button>
				<button
					type="button"
					class="jk-tonal-button"
					disabled={busy()}
					onClick={() =>
						void commands
							.restartApp()
							.catch((e: unknown) => setError(String(e)))
					}
				>
					{localize("重新启动")}
				</button>
				<button
					type="button"
					class="jk-tonal-button ml-auto"
					disabled={busy()}
					onClick={() => void finish(true)}
				>
					{localize("稍后设置")}
				</button>
				<Button disabled={!ready() || busy()} onClick={() => void finish()}>
					{localize("进入工作台")}
				</Button>
			</footer>
		</div>
	);
}
