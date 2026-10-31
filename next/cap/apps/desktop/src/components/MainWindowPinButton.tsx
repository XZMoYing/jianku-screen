import { getCurrentWindow } from "@tauri-apps/api/window";
import { createSignal } from "solid-js";
import toast from "solid-toast";
import { EditorButton } from "~/routes/editor/ui";
import { generalSettingsStore } from "~/store";
import { t } from "~/utils/i18n";
import { setMainWindowPinned } from "~/utils/window-level";
import IconLucidePin from "~icons/lucide/pin";

export function MainWindowPinButton() {
	const settings = generalSettingsStore.createQuery();
	const [busy, setBusy] = createSignal(false);
	const pinned = () => settings.data?.mainWindowAlwaysOnTop ?? false;
	const label = () => t(pinned() ? "Unpin main window" : "Pin main window");
	const toggle = async () => {
		if (busy() || settings.isPending) return;
		setBusy(true);
		try {
			await setMainWindowPinned(
				getCurrentWindow(),
				generalSettingsStore,
				!pinned(),
			);
		} catch (error) {
			toast.error(
				t("Could not change the main window pin: {error}", {
					error: String(error),
				}),
			);
		} finally {
			try {
				await settings.refetch();
			} finally {
				setBusy(false);
			}
		}
	};
	return (
		<EditorButton
			aria-label={label()}
			title={label()}
			aria-pressed={pinned()}
			disabled={busy() || settings.isPending || settings.isError}
			onClick={() => void toggle()}
			variant="primary"
			class={pinned() ? "bg-ed-ctl-active text-ed-accent" : ""}
			leftIcon={<IconLucidePin />}
		/>
	);
}
