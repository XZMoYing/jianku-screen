import * as dialog from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { t as localize } from "~/utils/i18n";
import type { createOptionsQuery } from "./queries";
import {
	commands,
	type RecordingAction,
	type RecordingMeta,
	type RecordingMode,
} from "./tauri";

export function displayRecordingName(name: string): string {
	const legacyDate = /^Cap (\d{4}-\d{2}-\d{2}) at (\d{2}\.\d{2}\.\d{2})$/.exec(
		name,
	);
	if (legacyDate) return `${localize("Cap")} ${legacyDate[1]} ${legacyDate[2]}`;
	return name.replace(/^Cap(?=\s|$)/, localize("Cap"));
}

export function isRecordingStorageError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : error;
	return (
		typeof message === "string" &&
		message.startsWith("Not enough space to finish this recording.")
	);
}

export function recordingMetaNeedsRecovery(meta: RecordingMeta): boolean {
	const status =
		"status" in meta
			? meta.status
			: "inner" in meta
				? meta.inner.status
				: undefined;
	if (!status || typeof status !== "object" || !("status" in status))
		return false;
	return status.status === "InProgress" || status.status === "NeedsRemux";
}

export function recordingOpenErrorMessage(
	error: unknown,
	projectPath: string,
): string {
	if (isRecordingStorageError(error)) {
		return `Not enough space to finish this recording. Your recording files have been kept at ${projectPath}. Free up space, then open the recording again.`;
	}
	return error instanceof Error ? error.message : String(error);
}

export async function runRecordingStopRequest(options: {
	stop: () => Promise<unknown>;
	isCurrent: () => boolean;
	onError: (error: unknown) => void;
	onSettled: () => void;
}) {
	try {
		await options.stop();
	} catch (error) {
		if (options.isCurrent()) options.onError(error);
	} finally {
		if (options.isCurrent()) options.onSettled();
	}
}

export function isRecordingStartCancelled(error: unknown): boolean {
	const message = error instanceof Error ? error.message : error;
	return message === "Recording cancelled before starting.";
}

export function handleRecordingResult(
	result: Promise<RecordingAction>,
	setOptions: ReturnType<typeof createOptionsQuery>["setOptions"] | undefined,
) {
	return result
		.then(async (result) => {
			if (result === "Started") return;
			if (result === "InvalidAuthentication") {
				const buttons = setOptions
					? {
							yes: localize("敬请期待"),
							no: localize("切换到录制模式"),
							cancel: localize("取消"),
						}
					: {
							ok: localize("敬请期待"),
							cancel: localize("取消"),
						};

				const result = await dialog.message(
					localize(
						"实时模式需要账号支持，账号功能敬请期待；你也可以切换到录制模式。",
					),
					{
						title: localize("功能即将推出"),
						buttons,
					},
				);

				if (result === buttons.no && setOptions) {
					setOptions({ mode: "studio" });
					commands.setRecordingMode("studio");
				}
			} else if (result === "UpgradeRequired") {
				await dialog.message(localize("账号与升级功能敬请期待。"), {
					title: localize("功能即将推出"),
				});
			} else
				await dialog.message(
					localize("录制启动失败：{reason}", { reason: result }),
					{
						title: localize("录制启动失败"),
					},
				);
		})
		.catch((error: unknown) => {
			if (isRecordingStartCancelled(error)) return;
			return dialog.message(
				error instanceof Error ? error.message : String(error),
				{
					title: localize("录制启动失败"),
					kind: "error",
				},
			);
		});
}

export async function openRecordingFolder(
	projectPath: string,
	mode: RecordingMode,
) {
	const path = projectPath.replace(/[/\\]+$/, "");

	const openedContent =
		mode === "instant" &&
		(await commands.openFilePath(`${path}/content`).then(
			() => true,
			() => false,
		));

	if (openedContent) return;

	await revealItemInDir(`${path}/`);
}
