import { Button } from "@cap/ui-solid";
import { resolveResource } from "@tauri-apps/api/path";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import toast from "solid-toast";
import { showAccountComingSoon } from "~/utils/auth";
import { t, tUnbranded } from "~/utils/i18n";
import { Section, SectionCard, SettingsPageContent } from "./Setting";

export default function Page() {
	const revealLicenses = async () => {
		try {
			const licenses = await resolveResource("licenses");
			await revealItemInDir(licenses);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : t("无法打开许可目录。"),
			);
		}
	};

	return (
		<div class="cap-settings-page h-full overflow-y-auto custom-scroll">
			<SettingsPageContent>
				<Section title={t("账号与服务")}>
					<SectionCard padded>
						<p class="text-sm text-gray-12">{t("简库镜传 Next")}</p>
						<p class="mt-2 text-xs leading-relaxed text-gray-10">
							{t("账号功能敬请期待，本地录制和编辑可正常使用。")}
						</p>
						<Button size="sm" class="mt-4" onClick={showAccountComingSoon}>
							{t("敬请期待")}
						</Button>
					</SectionCard>
				</Section>
				<Section title={t("开源许可")}>
					<SectionCard padded>
						<p class="text-sm text-gray-12">{tUnbranded("Cap / AGPLv3")}</p>
						<p class="mt-2 text-xs leading-relaxed text-gray-10">
							{tUnbranded(
								"本项目基于 Cap 0.6.0 修改，遵循 AGPLv3；源代码与构建说明见项目仓库。第三方组件许可随应用提供。",
							)}
						</p>
						<Button
							size="sm"
							class="mt-4"
							onClick={() => void revealLicenses()}
						>
							{t("查看随包许可文件")}
						</Button>
					</SectionCard>
				</Section>
			</SettingsPageContent>
		</div>
	);
}
