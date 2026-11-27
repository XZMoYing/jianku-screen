import { t as localize } from "~/utils/i18n";
import { Section, SectionCard, SettingsPageContent } from "../Setting";

export default function AppsTab() {
	return (
		<div class="cap-settings-page flex flex-col h-full custom-scroll">
			<SettingsPageContent>
				<Section
					title={localize("Integrations")}
					description={localize(
						"第三方云存储与在线集成功能暂未开放，当前版本全部录制与导出均在本地完成。",
					)}
				>
					<SectionCard padded>
						<p class="text-xs leading-relaxed text-gray-10">
							{localize("敬请期待后续本地与自定义工作流集成支持。")}
						</p>
					</SectionCard>
				</Section>
			</SettingsPageContent>
		</div>
	);
}
