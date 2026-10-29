import { Popover } from "@kobalte/core/popover";
import { invoke } from "@tauri-apps/api/core";
import { batch } from "solid-js";
import { BackgroundSettings } from "~/components/BackgroundSettings";
import { t } from "~/utils/i18n";
import { isProjectPath } from "~/utils/project-files";
import IconCapBgBlur from "~icons/cap/bg-blur";
import IconCapImage from "~icons/cap/image";
import { useScreenshotEditorContext } from "../context";
import { EditorButton, Field, Slider } from "../ui";

export function BackgroundSettingsPopover() {
	const context = useScreenshotEditorContext();
	return (
		<Popover
			placement="bottom-start"
			open={context.activePopover() === "background"}
			onOpenChange={(open) => {
				if (!open && context.activePopover() === "background")
					context.setActivePopover(null);
			}}
		>
			<Popover.Anchor
				as={EditorButton}
				onClick={() =>
					context.setActivePopover(
						context.activePopover() === "background" ? null : "background",
					)
				}
				leftIcon={<IconCapImage class="size-4" />}
				tooltipText={t("背景")}
				kbd={["B"]}
			/>
			<Popover.Portal>
				<Popover.Content class="jk-menu-surface z-50 w-[400px] overflow-hidden rounded-xl border border-gray-3 bg-gray-1 shadow-xl">
					<div class="max-h-[600px] overflow-y-auto p-4 flex flex-col gap-6">
						<BackgroundSettings
							background={context.project.background}
							projectPath={
								isProjectPath(context.path) ? context.path : undefined
							}
							pauseHistory={context.projectHistory.pause}
							onChange={(patch) => {
								const resume = context.projectHistory.pause();
								batch(() => {
									context.setProject("background", patch);
									resume();
								});
								const source = patch.source;
								if (
									(source?.type === "image" || source?.type === "wallpaper") &&
									source.path
								)
									void invoke("prewarm_screenshot_background", {
										path: source.path,
									}).catch(() => {});
							}}
						/>
						<Field name={t("背景模糊")} icon={<IconCapBgBlur />}>
							<Slider
								value={[context.project.background.blur]}
								onChange={(value) =>
									context.setProject("background", "blur", value[0])
								}
								minValue={0}
								maxValue={100}
								step={0.1}
								formatTooltip="%"
							/>
						</Field>
					</div>
				</Popover.Content>
			</Popover.Portal>
		</Popover>
	);
}
