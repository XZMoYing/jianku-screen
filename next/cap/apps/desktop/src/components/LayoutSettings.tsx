import { For, Show } from "solid-js";
import { RgbInput } from "~/routes/editor/color-utils";
import {
	ASPECT_RATIO_OPTIONS,
	ASPECT_RATIOS,
} from "~/routes/editor/projectConfig";
import { Field, Slider } from "~/routes/editor/ui";
import { t as localize } from "~/utils/i18n";
import type {
	AspectRatio,
	BackgroundConfiguration,
	CornerStyle,
} from "~/utils/tauri";
import { Toggle } from "./Toggle";

export function LayoutSettings(props: {
	background: BackgroundConfiguration;
	onChange: (patch: Partial<BackgroundConfiguration>) => void;
	aspectRatio: AspectRatio | null;
	onAspectRatio: (ratio: AspectRatio | null) => void;
	motionBlur: number;
	onMotionBlur: (amount: number) => void;
}) {
	const range = (
		name: string,
		key: "blur" | "padding" | "rounding" | "inset" | "shadow",
		max = 100,
		step = 0.1,
	) => (
		<Field
			inline
			name={name}
			disabled={key === "inset"}
			value={
				key === "inset"
					? localize("敬请期待")
					: `${Number(props.background[key].toFixed(1))}%`
			}
		>
			<Slider
				disabled={key === "inset"}
				value={[props.background[key]]}
				minValue={0}
				maxValue={max}
				step={step}
				onChange={([value]) => props.onChange({ [key]: value })}
			/>
		</Field>
	);
	const shadow = () =>
		props.background.advancedShadow ?? { size: 50, opacity: 18, blur: 50 };
	const border = () =>
		props.background.border ?? {
			enabled: false,
			width: 5,
			color: [0, 0, 0] as [number, number, number],
			opacity: 50,
		};
	return (
		<div class="jk-layout-settings">
			<label class="jk-control-row">
				<span>{localize("画面比例")}</span>
				<select
					aria-label={localize("捕获画面比例")}
					value={props.aspectRatio ?? "auto"}
					onChange={(event) =>
						props.onAspectRatio(
							event.currentTarget.value === "auto"
								? null
								: (event.currentTarget.value as AspectRatio),
						)
					}
				>
					<For each={ASPECT_RATIO_OPTIONS}>
						{(ratio) => (
							<option value={ratio}>
								{ratio === "auto"
									? localize("适合屏幕")
									: `${ASPECT_RATIOS[ratio].ratio.join(":")} · ${ASPECT_RATIOS[ratio].name}`}
							</option>
						)}
					</For>
				</select>
			</label>
			{range("背景模糊", "blur")}
			{range("留白", "padding", 40)}
			{range("圆角", "rounding")}
			<label class="jk-control-row">
				<span>{localize("圆角样式")}</span>
				<select
					aria-label={localize("圆角样式")}
					value={props.background.roundingType}
					onChange={(event) =>
						props.onChange({
							roundingType: event.currentTarget.value as CornerStyle,
						})
					}
				>
					<option value="rounded">{localize("圆润")}</option>
					<option value="squircle">{localize("连续曲率")}</option>
				</select>
			</label>
			{range("内边距", "inset", 100, 1)}
			<Show when={props.background.displayPosition}>
				<Field inline name="画面位置">
					<button
						type="button"
						onClick={() => props.onChange({ displayPosition: null })}
					>
						{localize("恢复居中")}
					</button>
				</Field>
			</Show>
			<Field
				inline
				name={localize("画面动态模糊")}
				value={`${Math.round(props.motionBlur * 100)}%`}
			>
				<Slider
					value={[props.motionBlur]}
					minValue={0}
					maxValue={1}
					step={0.01}
					onChange={([value]) => props.onMotionBlur(value)}
				/>
			</Field>
			{range("阴影", "shadow")}
			<details class="jk-appearance-details">
				<summary>{localize("阴影细节")}</summary>
				<div>
					<For
						each={
							[
								{ key: "size", name: "扩散" },
								{ key: "opacity", name: "不透明度" },
								{ key: "blur", name: "柔化" },
							] as const
						}
					>
						{(field) => (
							<Field
								inline
								name={localize(field.name)}
								value={`${Number(shadow()[field.key].toFixed(1))}%`}
							>
								<Slider
									value={[shadow()[field.key]]}
									minValue={0}
									maxValue={100}
									step={0.1}
									onChange={([value]) =>
										props.onChange({
											advancedShadow: { ...shadow(), [field.key]: value },
										})
									}
								/>
							</Field>
						)}
					</For>
				</div>
			</details>
			<Field inline name={localize("细边框")}>
				<Toggle
					checked={border().enabled}
					onChange={(enabled) =>
						props.onChange({ border: { ...border(), enabled } })
					}
				/>
			</Field>
			<Show when={border().enabled}>
				<Field
					inline
					name={localize("边框宽度")}
					value={`${border().width.toFixed(1)}px`}
				>
					<Slider
						value={[border().width]}
						minValue={1}
						maxValue={20}
						step={0.1}
						onChange={([width]) =>
							props.onChange({ border: { ...border(), width } })
						}
					/>
				</Field>
				<Field name={localize("边框颜色")}>
					<RgbInput
						value={border().color}
						onChange={(color) =>
							props.onChange({ border: { ...border(), color } })
						}
					/>
				</Field>
				<Field
					inline
					name={localize("边框不透明度")}
					value={`${border().opacity.toFixed(1)}%`}
				>
					<Slider
						value={[border().opacity]}
						minValue={0}
						maxValue={100}
						step={0.1}
						onChange={([opacity]) =>
							props.onChange({ border: { ...border(), opacity } })
						}
					/>
				</Field>
			</Show>
		</div>
	);
}
