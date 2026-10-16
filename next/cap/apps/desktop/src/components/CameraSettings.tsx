import { type as ostype } from "@tauri-apps/plugin-os";
import { For, Show } from "solid-js";
import { Field, Slider } from "~/routes/editor/ui";
import { t as localize } from "~/utils/i18n";
import type {
	BackgroundBlurMode,
	Camera,
	CameraShape,
	CornerStyle,
} from "~/utils/tauri";
import { cameraBackgroundOptions } from "./CameraPreviewChrome";
import { Toggle } from "./Toggle";

export function CameraSettings(props: {
	camera: Camera;
	onChange: (patch: Partial<Camera>) => void;
}) {
	const range = (
		name: string,
		key: "size" | "zoomSize" | "rounding" | "shadow",
		min: number,
		max: number,
	) => (
		<Field
			inline
			name={name}
			value={`${(props.camera[key] ?? 60).toFixed(1)}%`}
		>
			<Slider
				value={[props.camera[key] ?? 60]}
				minValue={min}
				maxValue={max}
				step={0.1}
				onChange={([value]) => props.onChange({ [key]: value })}
			/>
		</Field>
	);
	const shadow = () =>
		props.camera.advancedShadow ?? { size: 50, opacity: 18, blur: 50 };
	return (
		<div class="jk-camera-settings">
			<Field inline name={localize("显示摄像头")}>
				<Toggle
					checked={!props.camera.hide}
					onChange={(value) => props.onChange({ hide: !value })}
				/>
			</Field>
			<Show when={!props.camera.hide}>
				<div
					class="jk-camera-positions"
					role="group"
					aria-label={localize("摄像头位置")}
				>
					<For each={["top", "bottom"] as const}>
						{(y) => (
							<For each={["left", "center", "right"] as const}>
								{(x) => (
									<button
										type="button"
										aria-label={`${y} ${x}`}
										aria-pressed={
											!props.camera.manualPosition &&
											props.camera.position.x === x &&
											props.camera.position.y === y
										}
										onClick={() =>
											props.onChange({
												position: { x, y },
												manualPosition: null,
											})
										}
									>
										<span />
									</button>
								)}
							</For>
						)}
					</For>
				</div>
				<Field inline name={localize("镜像")}>
					<Toggle
						checked={props.camera.mirror}
						onChange={(mirror) => props.onChange({ mirror })}
					/>
				</Field>
				<label class="jk-control-row">
					<span>{localize("摄像头背景")}</span>
					<select
						aria-label={localize("摄像头背景")}
						value={props.camera.backgroundBlur?.mode ?? "off"}
						onChange={(event) =>
							props.onChange({
								backgroundBlur: {
									mode: event.currentTarget.value as BackgroundBlurMode,
								},
							})
						}
					>
						<For each={cameraBackgroundOptions(ostype() === "macos")}>
							{(option) => (
								<option value={option.value}>{localize(option.name)}</option>
							)}
						</For>
					</select>
				</label>
				<label class="jk-control-row">
					<span>{localize("形状")}</span>
					<select
						aria-label={localize("摄像头形状")}
						value={props.camera.shape}
						onChange={(event) =>
							props.onChange({
								shape: event.currentTarget.value as CameraShape,
							})
						}
					>
						<option value="square">{localize("方形")}</option>
						<option value="source">{localize("原始比例")}</option>
					</select>
				</label>
				{range("摄像头大小", "size", 20, 80)}
				{range("放大时大小", "zoomSize", 10, 60)}
				<Field inline name={localize("运镜时保持大小")}>
					<Toggle
						checked={props.camera.scaleDuringZoom === 1}
						onChange={(value) =>
							props.onChange({ scaleDuringZoom: value ? 1 : 0.7 })
						}
					/>
				</Field>
				{range("圆角", "rounding", 0, 100)}
				<label class="jk-control-row">
					<span>{localize("圆角样式")}</span>
					<select
						aria-label={localize("摄像头圆角样式")}
						value={props.camera.roundingType}
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
				{range("阴影", "shadow", 0, 100)}
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
									value={`${shadow()[field.key].toFixed(1)}%`}
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
			</Show>
		</div>
	);
}
