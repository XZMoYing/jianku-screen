import { Button } from "@cap/ui-solid";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { t } from "~/utils/i18n";

export default function Upgrade() {
	return (
		<main class="flex h-screen flex-col items-center justify-center gap-5 bg-gray-1 text-gray-12">
			<p>{t("账号功能敬请期待，本地录制和编辑可正常使用。")}</p>
			<Button onClick={() => getCurrentWindow().close()}>{t("Close")}</Button>
		</main>
	);
}
