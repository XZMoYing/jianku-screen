import { cx } from "cva";
import { For, type JSX, Show } from "solid-js";
import { t as localize } from "~/utils/i18n";
import type { TimelineSegment } from "~/utils/tauri";
import IconLucideMousePointerBan from "~icons/lucide/mouse-pointer-ban";
import IconLucideVolumeX from "~icons/lucide/volume-x";
import { clipAudioMuted, clipVolume } from "./clip-audio";
import { useEditorContext } from "./context";
import { Slider } from "./ui";

const CLIP_SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4, 8] as const;

function ClipMenuSection(props: { name: string; children: JSX.Element }) {
	return (
		<div class="flex flex-col gap-1">
			<span class="px-2 text-[10px] font-medium uppercase tracking-[0.08em] text-ed-text-3">
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
}) {
	return (
		<div
			role="radiogroup"
			aria-label={props.label}
			class="flex flex-wrap items-center gap-0.5 rounded-lg bg-ed-ctl p-0.5"
		>
			<For each={props.options}>
				{([value, label]) => (
					<button
						type="button"
						role="radio"
						aria-checked={props.value === value}
						class={cx(
							"flex-1 rounded-md px-1.5 py-1 text-[11.5px] whitespace-nowrap tabular-nums transition-colors outline-hidden focus-visible:ring-1 focus-visible:ring-ed-accent",
							props.value === value
								? "bg-ed-ctl-active text-ed-text-1"
								: "text-ed-text-2 hover:text-ed-text-1",
						)}
						onClick={() => props.onChange(value)}
					>
						{label}
					</button>
				)}
			</For>
		</div>
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
		<button
			type="button"
			role="switch"
			aria-checked={props.checked}
			class="flex h-10 w-full items-center gap-2.5 rounded-lg px-2 text-left transition-colors outline-hidden hover:bg-ed-ctl-hover focus-visible:bg-ed-ctl-hover"
			onClick={() => props.onChange(!props.checked)}
		>
			<span
				class={cx(
					"flex size-4 shrink-0 items-center justify-center [&_svg]:size-3.5",
					props.checked ? "text-ed-accent" : "text-ed-text-2",
				)}
			>
				{props.icon}
			</span>
			<span class="flex min-w-0 flex-1 flex-col leading-tight">
				<span class="truncate text-[12.5px] text-ed-text-1">{props.label}</span>
				<span class="text-[10.5px] text-ed-text-3">{props.description}</span>
			</span>
			<span
				aria-hidden
				class={cx(
					"cap-toggle relative h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
					props.checked ? "bg-ed-accent" : "bg-ed-ctl-active",
				)}
			>
				<span
					class={cx(
						"cap-toggle-thumb block size-4 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.22)] transition-transform",
						props.checked && "translate-x-full",
					)}
				/>
			</span>
		</button>
	);
}

export function ClipProperties(props: {
	index: number;
	segment: TimelineSegment;
}) {
	const { projectActions } = useEditorContext();
	const muted = () => clipAudioMuted(props.segment);
	const normalSpeed = () => props.segment.timescale === 1;
	const cursorHidden = () => props.segment.hideCursor === true;
	return (
		<>
			<ClipMenuSection name={localize("变速")}>
				<ClipMenuChips
					label={localize("Clip speed")}
					options={CLIP_SPEEDS.map((mult) => [mult, `${mult}x`] as const)}
					value={props.segment.timescale}
					onChange={(mult) =>
						projectActions.setClipSegmentTimescale(props.index, mult)
					}
				/>
			</ClipMenuSection>

			<ClipMenuSection name={localize("Audio")}>
				<div class="flex h-7 items-center gap-2 px-2 text-[11.5px]">
					<span class="w-12 shrink-0 text-ed-text-2">{localize("Volume")}</span>
					<Slider
						class="min-w-0 flex-1"
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
					<span class="w-9 shrink-0 text-right tabular-nums text-ed-text-2">
						{Math.round(clipVolume(props.segment) * 100)}%
					</span>
				</div>
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
		</>
	);
}
