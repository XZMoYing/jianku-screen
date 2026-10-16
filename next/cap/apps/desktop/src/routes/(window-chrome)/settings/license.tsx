import { Button } from "@cap/ui-solid";
import { showAccountComingSoon } from "~/utils/auth";
import { t } from "~/utils/i18n";
import { Section, SectionCard, SettingsPageContent } from "./Setting";

export default function Page() {
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
			</SettingsPageContent>
		</div>
	);
}
