import { For, Show } from "solid-js";
import {
	type CursorFamily,
	CursorRippleControls,
	CursorStyleOptions,
} from "~/routes/editor/CursorStylePicker";
import { Field, Slider } from "~/routes/editor/ui";
import { t as localize } from "~/utils/i18n";
import type { CursorAnimationStyle, CursorConfiguration } from "~/utils/tauri";
import { Toggle } from "./Toggle";

const presets = [
	{ id: "slow", name: "舒缓", tension: 200, mass: 2.25, friction: 40 },
	{ id: "smooth", name: "平滑", tension: 80, mass: 2.5, friction: 28 },
	{ id: "mellow", name: "自然", tension: 470, mass: 3, friction: 70 },
	{ id: "fast", name: "灵敏", tension: 380, mass: 1, friction: 30 },
] as const;

export function CursorSettings(props: {
	cursor: CursorConfiguration;
	recorded?: CursorFamily;
	onChange: (patch: Partial<CursorConfiguration>) => void;
}) {
	const number = (
		name: string,
		key:
			| "size"
			| "rotationAmount"
			| "motionBlur"
			| "hideWhenIdleDelay"
			| "tension"
			| "friction"
			| "mass",
		min: number,
		max: number,
		step = 1,
		factor = 1,
		unit = "",
	) => (
		<Field
			inline
			name={name}
			value={`${Number(((props.cursor[key] ?? 0) * factor).toFixed(2))}${unit}`}
		>
			<Slider
				value={[(props.cursor[key] ?? 0) * factor]}
				minValue={min}
				maxValue={max}
				step={step}
				onChange={([value]) => {
					const patch = { [key]: value / factor };
					if (key === "tension" || key === "mass" || key === "friction") {
						const next = { ...props.cursor, ...patch };
						const preset = presets.find(
							(p) =>
								Math.abs(p.tension - next.tension) <= 1 &&
								Math.abs(p.mass - next.mass) <= 0.05 &&
								Math.abs(p.friction - next.friction) <= 0.2,
						);
						props.onChange({
							...patch,
							animationStyle: preset?.id ?? "custom",
						});
					} else props.onChange(patch);
				}}
			/>
		</Field>
	);
	return (
		<div class="jk-cursor-settings">
			<Field inline name={localize("显示光标")}>
				<Toggle
					checked={!props.cursor.hide}
					onChange={(value) => props.onChange({ hide: !value })}
				/>
			</Field>
			<Show when={!props.cursor.hide}>
				<CursorStyleOptions
					value={props.cursor.type}
					recorded={props.recorded}
					onChange={(type) => props.onChange({ type })}
				/>
				{number("光标大小", "size", 20, 300, 1, 1, "%")}
				{number("移动倾斜", "rotationAmount", 0, 100, 1, 100, "%")}
				<CursorRippleControls
					value={props.cursor.ripple}
					onChange={(ripple) => props.onChange({ ripple })}
				/>
				<Field inline name={localize("静止时隐藏")}>
					<Toggle
						checked={props.cursor.hideWhenIdle}
						onChange={(hideWhenIdle) => props.onChange({ hideWhenIdle })}
					/>
				</Field>
				<Show when={props.cursor.hideWhenIdle}>
					{number("隐藏等待", "hideWhenIdleDelay", 0.5, 5, 0.1, 1, "s")}
				</Show>
				<label class="jk-control-row">
					<span>{localize("移动风格")}</span>
					<select
						aria-label={localize("光标移动风格")}
						value={props.cursor.animationStyle}
						onChange={(event) => {
							const preset = presets.find(
								(p) => p.id === event.currentTarget.value,
							);
							props.onChange(
								preset
									? {
											animationStyle: preset.id,
											tension: preset.tension,
											mass: preset.mass,
											friction: preset.friction,
										}
									: { animationStyle: "custom" as CursorAnimationStyle },
							);
						}}
					>
						<For each={presets}>
							{(p) => <option value={p.id}>{localize(p.name)}</option>}
						</For>
						<option value="custom">{localize("自定义")}</option>
					</select>
				</label>
				<Field inline name={localize("平滑移动")}>
					<Toggle
						checked={!props.cursor.raw}
						onChange={(value) => props.onChange({ raw: !value })}
					/>
				</Field>
				<Show
					when={!props.cursor.raw && props.cursor.animationStyle === "custom"}
				>
					{number("张力", "tension", 1, 600)}
					{number("阻尼", "friction", 0, 200, 0.1)}
					{number("质量", "mass", 0.1, 15, 0.01)}
				</Show>
				{number("动态模糊", "motionBlur", 0, 100, 1, 100, "%")}
				<Field inline name={localize("高质量矢量光标")}>
					<Toggle
						checked={props.cursor.useSvg ?? true}
						onChange={(useSvg) => props.onChange({ useSvg })}
					/>
				</Field>
			</Show>
		</div>
	);
}
