import { createMutation } from "@tanstack/solid-query";
import { type as ostype } from "@tauri-apps/plugin-os";
import { Show } from "solid-js";
import toast from "solid-toast";
import { generalSettingsStore } from "~/store";
import { t } from "~/utils/i18n";
import { Toggle } from "./Toggle";

export default function WindowCaptureOptions(props: { disabled?: boolean }) {
	const settings = generalSettingsStore.createQuery();
	const save = createMutation(() => ({
		mutationFn: (value: boolean) =>
			generalSettingsStore.set({ isolateWindowCapture: value }),
		onError: (error: unknown) => toast.error(String(error)),
	}));

	return (
		<Show when={ostype() === "macos"}>
			<div class="flex shrink-0 items-center justify-between gap-4 rounded-2xl bg-gray-2 p-3 text-gray-12">
				<div class="space-y-1">
					<p class="text-sm font-medium">{t("过滤其他窗口")}</p>
					<p class="text-xs text-gray-11">
						{t("关闭时保留遮挡内容；开启后只录所选窗口。")}
					</p>
				</div>
				<Toggle
					aria-label={t("过滤其他窗口")}
					checked={settings.data?.isolateWindowCapture ?? false}
					disabled={props.disabled || settings.isPending || save.isPending}
					onChange={(value) => save.mutate(value)}
				/>
			</div>
		</Show>
	);
}
