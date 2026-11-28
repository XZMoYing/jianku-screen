import { cx } from "cva";
import { For, type JSX, Show } from "solid-js";
import { MotionGroup } from "~/components/InterfaceMotion";
import { Toggle } from "~/components/Toggle";
import { t as localize } from "~/utils/i18n";
import type { TimelineSegment } from "~/utils/tauri";
import IconLucideMousePointerBan from "~icons/lucide/mouse-pointer-ban";
import IconLucideVolumeX from "~icons/lucide/volume-x";
import { clipAudioMuted, clipVolume } from "./clip-audio";
import { useEditorContext } from "./context";
import { Field, Slider } from "./ui";

const CLIP_SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4, 8] as const;

export type ClipPropertySection = "speed" | "audio" | "cursor";

function ClipMenuSection(props: { name: string; children: JSX.Element }) {
	return (
		<div class="jk-ed-card flex flex-col gap-2.5 p-3.5">
			<span class="text-[11px] font-medium uppercase tracking-[0.06em] text-ed-text-3">
				{props.name}
			</span>
			{props.children}
		</div>
	);
}

function ClipMenuChips<T extends string | number>(props: {
	options: ReadonlyArray<readonly [T, string]>;
	value: T;
	onChange: (value: T) => void;
	label: string;
	compact?: boolean;
}) {
	return (
		<MotionGroup class="jk-ed-seg w-full" label={props.label}>
			<For each={props.options}>
				{([value, label]) => (
					<button
						type="button"
						role="radio"
						aria-checked={props.value === value}
						class={cx(
							"jk-ed-seg-item flex-1 tabular-nums outline-hidden focus-visible:ring-1 focus-visible:ring-ed-accent",
							props.compact && "px-1 text-[11px]",
						)}
						onClick={() => props.onChange(value)}
					>
						{label}
					</button>
				)}
			</For>
		</MotionGroup>
	);
}

function ClipMenuToggleRow(props: {
	icon: JSX.Element;
	label: string;
	description: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
}) {
	return (
		<div class="flex min-h-10 w-full items-center gap-2.5 rounded-lg py-0.5 transition-colors">
			<span
				class="jk-ed-icon-tile [&_svg]:size-4"
				data-active={props.checked ? "true" : undefined}
			>
				{props.icon}
			</span>
			<button
				type="button"
				class="flex min-w-0 flex-1 flex-col text-left leading-tight outline-hidden"
				onClick={() => props.onChange(!props.checked)}
			>
				<span class="truncate text-[12.5px] font-medium text-ed-text-1">
					{props.label}
				</span>
				<span class="text-[11px] text-ed-text-3">{props.description}</span>
			</button>
			<Toggle size="sm" checked={props.checked} onChange={props.onChange} />
		</div>
	);
}

export function ClipProperties(props: {
	index: number;
	segment: TimelineSegment;
	section?: ClipPropertySection;
}) {
	const { projectActions } = useEditorContext();
	const muted = () => clipAudioMuted(props.segment);
	const normalSpeed = () => props.segment.timescale === 1;
	const cursorHidden = () => props.segment.hideCursor === true;
	return (
		<>
			<Show when={!props.section || props.section === "speed"}>
				<ClipMenuSection name={localize("变速")}>
					<ClipMenuChips
						compact
						label={localize("Clip speed")}
						options={CLIP_SPEEDS.map((mult) => [mult, `${mult}x`] as const)}
						value={props.segment.timescale}
						onChange={(mult) =>
							projectActions.setClipSegmentTimescale(props.index, mult)
						}
					/>
				</ClipMenuSection>
			</Show>

			<Show when={!props.section || props.section === "audio"}>
				<ClipMenuSection name={localize("Audio")}>
					<Field
						inline
						class="h-[32px]"
						name={localize("Volume")}
						value={`${Math.round(clipVolume(props.segment) * 100)}%`}
					>
						<Slider
							aria-label={localize("Clip volume")}
							value={[Math.round(clipVolume(props.segment) * 100)]}
							minValue={0}
							maxValue={200}
							step={1}
							disabled={muted()}
							onChange={([value]) =>
								projectActions.setClipSegmentVolume(props.index, value / 100)
							}
							formatTooltip={(value) => `${value}%`}
						/>
					</Field>
					<Show
						when={!normalSpeed()}
						fallback={
							<ClipMenuToggleRow
								icon={<IconLucideVolumeX />}
								label={localize("Mute clip")}
								description={localize("Silence this clip's audio")}
								checked={muted()}
								onChange={(checked) =>
									projectActions.setClipSegmentMuted(props.index, checked)
								}
							/>
						}
					>
						<ClipMenuChips
							label={localize("Audio at this speed")}
							options={
								[
									["mute", localize("静音")],
									["maintainPitch", localize("保持音高")],
									["matchSpeed", localize("随速度变化")],
								] as const
							}
							value={props.segment.speedAudioMode ?? "mute"}
							onChange={(mode) =>
								projectActions.setClipSegmentSpeedAudioMode(props.index, mode)
							}
						/>
					</Show>
				</ClipMenuSection>
			</Show>

			<Show when={!props.section || props.section === "cursor"}>
				<ClipMenuSection name={localize("光标")}>
					<ClipMenuToggleRow
						icon={<IconLucideMousePointerBan />}
						label={localize("Hide cursor")}
						description={localize("Fades out while this clip plays")}
						checked={cursorHidden()}
						onChange={(checked) =>
							projectActions.setClipSegmentHideCursor(props.index, checked)
						}
					/>
				</ClipMenuSection>
			</Show>
		</>
	);
}
