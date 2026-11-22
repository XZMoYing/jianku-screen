import { HoverCard } from "@kobalte/core/hover-card";
import { cx } from "cva";
import { createEffect, createSignal, type JSX, Show } from "solid-js";
import { useRecordingOptions } from "~/routes/(window-chrome)/OptionsContext";
import { t as localize } from "~/utils/i18n";
import { commands, events, type RecordingMode } from "~/utils/tauri";
import IconImage from "~icons/lucide/image";
import IconInfo from "~icons/lucide/info";
import IconVideo from "~icons/lucide/video";
import { MotionGroup, useMotionInteraction } from "./InterfaceMotion";

interface ModeProps {
	onInfoClick?: () => void;
	locked?: boolean;
}

type ModeButtonConfig = {
	mode: RecordingMode;
	label: string;
	description: string;
	settingsSection: "instant-quality" | "studio-quality" | null;
	icon: (props: { class?: string }) => JSX.Element;
	iconClass: string;
};

const MODE_BUTTONS: ModeButtonConfig[] = [
	{
		mode: "studio",
		label: "视频",
		description: "录制保存在本机，停止后打开编辑器。可在设置中选择录制质量。",
		settingsSection: "studio-quality",
		icon: (p) => <IconVideo {...p} />,
		iconClass: "size-4",
	},
	{
		mode: "screenshot",
		label: "截图",
		description: "截图后添加标注，保存或复制到剪贴板。",
		settingsSection: null,
		icon: (p) => <IconImage {...p} />,
		iconClass: "size-4",
	},
];

const Mode = (props: ModeProps) => {
	const { rawOptions, setOptions } = useRecordingOptions();
	const interactive = useMotionInteraction();
	const [hovered, setHovered] = createSignal<RecordingMode | null>(null);
	createEffect(() => {
		if (!interactive()) setHovered(null);
	});

	const handleInfoClick = () => {
		if (props.locked || !interactive()) return;
		if (props.onInfoClick) {
			props.onInfoClick();
		} else {
			commands.showWindow("ModeSelect");
		}
	};

	const openQualitySettings = async (
		section: "instant-quality" | "studio-quality",
	) => {
		if (!interactive()) return;
		try {
			localStorage.setItem("cap.settings.scrollToSection", section);
		} catch {}
		await commands.showWindow({ Settings: { page: "quality" } });
		await events.requestScrollToSettingsSection.emit({ section });
	};

	return (
		<div class="flex relative gap-1.5 items-center w-fit">
			<button
				type="button"
				onClick={handleInfoClick}
				disabled={props.locked}
				class={cx(
					"jk-button flex size-7 items-center justify-center rounded-lg text-[var(--jk-muted)] hover:text-[var(--jk-ink)] focus:outline-none",
					props.locked && "opacity-50",
				)}
				aria-label={localize("捕获方式说明")}
			>
				<IconInfo class="size-3.5" />
			</button>

			<MotionGroup class="jk-mode-seg" label={localize("捕获方式")}>
				{MODE_BUTTONS.map((button) => {
					const isSelected = () => rawOptions.mode === button.mode;

					return (
						<HoverCard
							open={interactive() && hovered() === button.mode}
							onOpenChange={(open) =>
								setHovered((current) =>
									open && interactive()
										? button.mode
										: current === button.mode
											? null
											: current,
								)
							}
							openDelay={120}
							closeDelay={80}
							placement="bottom-end"
							gutter={12}
						>
							<HoverCard.Trigger
								as="button"
								type="button"
								aria-pressed={isSelected()}
								onClick={() => {
									if (props.locked || !interactive()) return;
									setOptions({ mode: button.mode });
									commands.setRecordingMode(button.mode);
								}}
								aria-disabled={props.locked && !isSelected()}
								class={cx(
									"relative flex gap-1.5 justify-center items-center rounded-[7px] px-2.5 h-7 text-[11.5px] font-medium focus:outline-none transition-colors",
									isSelected()
										? "is-selected text-[var(--jk-ink)] font-semibold"
										: props.locked
											? "opacity-40 cursor-default text-[var(--jk-muted)]"
											: "text-[var(--jk-muted)] hover:text-[var(--jk-ink)]",
								)}
							>
								<button.icon class="size-3.5" />
								<span>{localize(button.label)}</span>
							</HoverCard.Trigger>
							<HoverCard.Portal>
								<HoverCard.Content class="z-50 outline-none animate-in fade-in slide-in-from-top-1 duration-100">
									<div class="jk-menu-surface flex flex-col gap-2 px-3 py-2.5 min-w-[12rem] max-w-[15rem] text-[var(--jk-ink)]">
										<div class="flex flex-col gap-0.5">
											<span class="text-xs font-semibold">
												{localize(button.label)}
											</span>
											<span class="text-[11px] text-[var(--jk-muted)] leading-snug">
												{localize(button.description)}
											</span>
										</div>
										<Show when={button.settingsSection}>
											{(section) => (
												<button
													type="button"
													onClick={(e) => {
														e.stopPropagation();
														void openQualitySettings(section());
													}}
													class="flex gap-1.5 items-center px-2 py-1 -mx-1 text-[11px] rounded-md transition-colors text-[var(--jk-primary)] hover:bg-[var(--jk-well)]"
												>
													<IconCapSettings class="size-3" />
													<span>{localize("Quality settings")}</span>
												</button>
											)}
										</Show>
									</div>
								</HoverCard.Content>
							</HoverCard.Portal>
						</HoverCard>
					);
				})}
			</MotionGroup>
		</div>
	);
};

export default Mode;
