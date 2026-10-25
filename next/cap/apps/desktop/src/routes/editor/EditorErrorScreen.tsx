import { Button } from "@cap/ui-solid";
import { createMutation } from "@tanstack/solid-query";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { type as ostype } from "@tauri-apps/plugin-os";
import { createEffect, onCleanup, Show } from "solid-js";
import CaptionControlsWindows11 from "~/components/titlebar/controls/CaptionControlsWindows11";
import { createTauriEventListener } from "~/utils/createEventListener";
import { t as localize } from "~/utils/i18n";
import { isRecordingStorageError } from "~/utils/recording";
import { commands } from "~/utils/tauri";
import IconAlertTriangle from "~icons/lucide/alert-triangle";
import IconFolder from "~icons/lucide/folder";
import IconLoaderCircle from "~icons/lucide/loader-circle";
import IconRefreshCw from "~icons/lucide/refresh-cw";

const NEEDS_RECOVERY_PATTERN = /may need to be recovered/i;

function isRecoveryNeededError(error: string): boolean {
	return NEEDS_RECOVERY_PATTERN.test(error);
}

export function EditorErrorScreen(props: {
	error: string;
	projectPath: string;
}) {
	const storageShortage = () => isRecordingStorageError(props.error);
	const needsRecovery = () =>
		!!props.projectPath &&
		(storageShortage() || isRecoveryNeededError(props.error));
	const isMac = () => ostype() === "macos";

	let disposed = false;
	let listening = false;
	let checkAfterPending = false;
	let queryRequest = 0;
	let recoveryRequest = 0;
	let activeProjectPath = props.projectPath;

	const successStorageKey = (projectPath: string) =>
		`cap:recording-recovery-success:${projectPath}`;

	const isCurrentRecovery = (projectPath: string, request: number) =>
		!disposed &&
		props.projectPath === projectPath &&
		recoveryRequest === request;

	const recoverMutation = createMutation(() => ({
		onError: (error) => console.error("Recording recovery failed:", error),
		onMutate: () => {
			queryRequest += 1;
			checkAfterPending = false;
		},
		mutationFn: async ({
			projectPath,
			request,
		}: {
			projectPath: string;
			request: number;
		}) => {
			if (!isCurrentRecovery(projectPath, request)) return projectPath;
			const result = await commands.recoverRecording(projectPath);
			if (!isCurrentRecovery(projectPath, request)) return result;
			await commands.showWindow({ Editor: { project_path: result } });
			return result;
		},
		onSuccess: async (_result, { projectPath, request }) => {
			if (!isCurrentRecovery(projectPath, request)) return;
			queryRequest += 1;
			checkAfterPending = false;
			try {
				const successId = await invoke<string | null>(
					"get_recording_recovery_success",
					{ projectPath },
				);
				if (!isCurrentRecovery(projectPath, request)) return;
				if (typeof successId === "string" && successId.length > 0) {
					window.sessionStorage.setItem(
						successStorageKey(projectPath),
						successId,
					);
				}
			} catch (error) {
				console.error("Failed to remember recording recovery", error);
			}
			if (!isCurrentRecovery(projectPath, request)) return;
			queryRequest += 1;
			checkAfterPending = false;
			window.location.reload();
		},
	}));

	const checkRecoverySuccess = async (projectPath: string) => {
		if (disposed || !listening || projectPath !== props.projectPath) return;
		if (recoverMutation.isPending) {
			checkAfterPending = true;
			return;
		}
		const request = ++queryRequest;
		try {
			const successId = await invoke<string | null>(
				"get_recording_recovery_success",
				{ projectPath },
			);
			if (
				disposed ||
				request !== queryRequest ||
				projectPath !== props.projectPath
			)
				return;
			if (recoverMutation.isPending) {
				checkAfterPending = true;
				return;
			}
			if (typeof successId !== "string" || successId.length === 0) return;
			const key = successStorageKey(projectPath);
			if (window.sessionStorage.getItem(key) === successId) return;
			window.sessionStorage.setItem(key, successId);
			window.location.reload();
		} catch (error) {
			console.error("Failed to check recording recovery", error);
		}
	};

	createTauriEventListener<string>(
		{
			listen: (callback) =>
				listen<string>("recording-recovery-completed", callback)
					.then((unlisten) => {
						if (!disposed) {
							listening = true;
							void checkRecoverySuccess(props.projectPath);
						}
						return unlisten;
					})
					.catch((error: unknown) => {
						console.error("Failed to listen for recording recovery", error);
						return () => undefined;
					}),
		},
		() => {
			listening = true;
			void checkRecoverySuccess(props.projectPath);
		},
	);

	createEffect(() => {
		const projectPath = props.projectPath;
		const pending = recoverMutation.isPending;
		if (projectPath !== activeProjectPath) {
			activeProjectPath = projectPath;
			queryRequest += 1;
			recoveryRequest += 1;
			checkAfterPending = false;
			void checkRecoverySuccess(projectPath);
		} else if (!pending && checkAfterPending) {
			checkAfterPending = false;
			void checkRecoverySuccess(projectPath);
		}
	});

	onCleanup(() => {
		disposed = true;
		queryRequest += 1;
		recoveryRequest += 1;
		checkAfterPending = false;
	});

	const windowAction = createMutation(() => ({
		onError: (error) => console.error("Editor recovery action failed:", error),
		mutationFn: async (action: "home" | "close" | "folder") => {
			if (action === "folder") {
				await revealItemInDir(props.projectPath);
				return;
			}
			if (action === "home") {
				await commands.showWindow({ Main: { init_target_mode: null } });
			}
			await getCurrentWindow().close();
		},
	}));
	const busy = () => recoverMutation.isPending || windowAction.isPending;

	return (
		<div data-editor-error class="flex flex-col flex-1 min-h-0">
			<div
				data-tauri-drag-region
				class="flex relative flex-row items-center w-full h-14 px-4"
			>
				{isMac() && <div class="h-full w-16" />}
				<div data-tauri-drag-region class="flex-1 h-full" />
				{ostype() === "windows" && <CaptionControlsWindows11 />}
			</div>

			<div class="flex-1 min-h-0 overflow-y-auto p-8">
				<div class="max-w-md w-full space-y-6 mx-auto my-6">
					<div class="flex flex-col items-center text-center space-y-3">
						<div class="size-16 rounded-full bg-red-2 flex items-center justify-center">
							<IconAlertTriangle class="size-8 text-red-9" />
						</div>
						<h2 class="text-xl font-semibold text-gray-12">
							{storageShortage()
								? localize("需要更多存储空间")
								: needsRecovery()
									? localize("需要恢复录制文件")
									: localize("无法打开录制文件")}
						</h2>
						<p class="text-sm text-gray-11">
							{needsRecovery()
								? localize(
										"Follow the steps below to try recovering the recording.",
									)
								: localize(
										"Check that the project and its original media are still in their original location, then reload the editor.",
									)}
						</p>
						<details class="w-full text-sm text-gray-11 text-left">
							<summary class="cursor-pointer">
								{localize("Error details")}
							</summary>
							<p class="mt-2 break-words whitespace-pre-wrap">{props.error}</p>
						</details>
					</div>

					<Show when={!needsRecovery()}>
						<Button
							data-editor-error-action="retry"
							onClick={() => window.location.reload()}
							disabled={busy()}
							variant="primary"
							class="w-full"
						>
							<IconRefreshCw class="size-4 mr-2" />
							{localize("Reload")}
						</Button>
					</Show>

					<Show when={needsRecovery()}>
						<div class="bg-gray-2 border border-gray-4 rounded-xl p-4 space-y-4">
							<div class="space-y-2">
								<h3 class="font-medium text-gray-12 text-sm">
									{storageShortage()
										? localize("完成录制文件保存")
										: localize("自动恢复")}
								</h3>
								<p class="text-xs text-gray-11">
									{storageShortage()
										? localize(
												"请先清理录制磁盘空间，再点击“恢复录制”。录制文件已为你保留。",
											)
										: localize(
												"简库镜传可以尝试自动恢复录制，并根据已有片段重建工程。",
											)}
								</p>
							</div>

							<Button
								onClick={() =>
									recoverMutation.mutate({
										projectPath: props.projectPath,
										request: ++recoveryRequest,
									})
								}
								disabled={busy()}
								variant="primary"
								class="w-full"
							>
								<Show
									when={recoverMutation.isPending}
									fallback={
										<>
											<IconRefreshCw class="size-4 mr-2" />
											{localize("Recover Recording")}
										</>
									}
								>
									<IconLoaderCircle class="size-4 mr-2 animate-spin" />
									{localize("Recovering...")}
								</Show>
							</Button>

							<Show when={recoverMutation.error}>
								<div class="bg-red-2 border border-red-6 rounded-lg p-3">
									<p class="text-red-11 text-xs">
										{localize("Recovery failed:")}{" "}
										{recoverMutation.error instanceof Error
											? recoverMutation.error.message
											: String(recoverMutation.error)}
									</p>
								</div>
							</Show>
						</div>
					</Show>

					<Show when={props.projectPath}>
						<div class="bg-gray-2 border border-gray-4 rounded-xl p-4 space-y-4">
							<div class="space-y-2">
								<h3 class="font-medium text-gray-12 text-sm">
									{localize("Manual Investigation")}
								</h3>
								<p class="text-xs text-gray-11">
									{localize(
										"You can open the recording folder to inspect the raw files directly.",
									)}
								</p>

								<div class="bg-gray-3 rounded-lg p-3 space-y-2">
									<p class="text-xs font-mono text-gray-11 break-all">
										{props.projectPath}
									</p>
									<Show
										when={isMac()}
										fallback={
											<p class="text-xs text-gray-10 italic">
												{localize(
													"Tip: Double-click inside the folder to browse the contents.",
												)}
											</p>
										}
									>
										<p class="text-xs text-gray-10 italic">
											{localize(
												'Tip: Right-click and select "Show Enclosing Folder" to see the .jks project contents.',
											)}
										</p>
									</Show>
								</div>
							</div>

							<Button
								onClick={() => windowAction.mutate("folder")}
								disabled={busy()}
								variant="outline"
								class="w-full"
							>
								<IconFolder class="size-4 mr-2" />
								{localize("Open Folder")}
							</Button>
						</div>
					</Show>

					<Show when={windowAction.error}>
						<p
							data-editor-action-error
							role="alert"
							class="text-sm text-red-11"
						>
							{localize("The action could not be completed. Please try again.")}
						</p>
					</Show>
					<Button
						data-editor-error-action="home"
						onClick={() => windowAction.mutate("home")}
						disabled={busy()}
						variant="outline"
						class="w-full"
					>
						{localize("Return to Home")}
					</Button>

					<div class="flex justify-center">
						<button
							type="button"
							data-editor-error-action="close"
							onClick={() => windowAction.mutate("close")}
							disabled={busy()}
							class="text-sm text-gray-10 hover:text-gray-11 transition-colors"
						>
							{localize("Close Window")}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
