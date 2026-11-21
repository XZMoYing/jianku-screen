import { cx } from "cva";
import { For, Show } from "solid-js";
import { Toggle } from "~/components/Toggle";
import { t as localize } from "~/utils/i18n";
import type { ShapeKind } from "~/utils/tauri";
import IconLucideCrosshair from "~icons/lucide/crosshair";
import { useEditorContext } from "./context";
import {
	nextShapeBadgeNumber,
	SHAPE_ANIMATIONS,
	SHAPE_ARROW_HEADS,
	SHAPE_COLOR_SWATCHES,
	SHAPE_KINDS,
	shapeAnimationLabel,
	shapeArrowHeadLabel,
	shapeDisplayName,
	shapeKindLabel,
	shapeKindStyleDefaults,
	shapeKindSupportsCornerRadius,
	shapeKindSupportsFill,
} from "./shapes";
import { EditorButton, Field, SectionLabel, Slider } from "./ui";

export function ShapeSegmentConfig(props: { index: number }) {
	const { project, setProject, projectActions } = useEditorContext();
	const segment = () => project.timeline?.shapeSegments[props.index];

	const applyKind = (kind: ShapeKind) => {
		const current = segment();
		if (!current || current.kind === kind) return;
		const defaults = shapeKindStyleDefaults(kind);
		const all = project.timeline?.shapeSegments ?? [];
		const nextNumber =
			kind === "badge" && current.number < 1
				? nextShapeBadgeNumber(all)
				: current.number;
		setProject("timeline", "shapeSegments", props.index, {
			kind,
			...defaults,
			number: nextNumber,
		});
	};

	const centerOnCanvas = () => {
		const current = segment();
		if (!current) return;
		const cxPos = (current.from.x + current.to.x) / 2;
		const cyPos = (current.from.y + current.to.y) / 2;
		const dx = 0.5 - cxPos;
		const dy = 0.5 - cyPos;
		setProject("timeline", "shapeSegments", props.index, {
			from: { x: current.from.x + dx, y: current.from.y + dy },
			to: { x: current.to.x + dx, y: current.to.y + dy },
		});
	};

	return (
		<Show when={segment()}>
			{(shape) => (
				<div class="flex flex-col gap-3.5 p-4">
					<div class="flex items-center justify-between gap-2">
						<span class="truncate text-[13px] font-medium text-ed-text-1">
							{shapeDisplayName(shape())}
						</span>
						<div class="flex items-center gap-2">
							<Toggle
								checked={shape().enabled}
								onChange={(value) =>
									setProject(
										"timeline",
										"shapeSegments",
										props.index,
										"enabled",
										value,
									)
								}
							/>
							<EditorButton
								variant="danger"
								onClick={() =>
									projectActions.deleteOverlaySegments("shape", [props.index])
								}
							>
								{localize("Delete")}
							</EditorButton>
						</div>
					</div>

					<div class="flex flex-col gap-2 rounded-lg bg-ed-card-2 p-3">
						<SectionLabel name={localize("Shape type")} />
						<div class="grid grid-cols-3 gap-1.5">
							<For each={SHAPE_KINDS}>
								{(kind) => (
									<button
										type="button"
										class={cx(
											"h-8 rounded-md px-2 text-xs font-medium transition-colors",
											shape().kind === kind
												? "bg-ed-accent text-white"
												: "bg-ed-ctl text-ed-text-2 hover:bg-ed-ctl-hover hover:text-ed-text-1",
										)}
										onClick={() => applyKind(kind)}
									>
										{localize(shapeKindLabel(kind))}
									</button>
								)}
							</For>
						</div>

						<Show when={shape().kind === "arrow"}>
							<div class="mt-1 flex flex-col gap-1.5">
								<span class="text-[11px] font-medium text-ed-text-3">
									{localize("Arrowhead")}
								</span>
								<div class="grid grid-cols-3 gap-1.5">
									<For each={SHAPE_ARROW_HEADS}>
										{(head) => (
											<button
												type="button"
												class={cx(
													"h-7 rounded-md px-2 text-xs font-medium transition-colors",
													shape().arrowHead === head
														? "bg-ed-accent text-white"
														: "bg-ed-ctl text-ed-text-2 hover:bg-ed-ctl-hover hover:text-ed-text-1",
												)}
												onClick={() =>
													setProject(
														"timeline",
														"shapeSegments",
														props.index,
														"arrowHead",
														head,
													)
												}
											>
												{localize(shapeArrowHeadLabel(head))}
											</button>
										)}
									</For>
								</div>
							</div>
						</Show>

						<Show when={shape().kind === "badge"}>
							<Field inline name={localize("Step number")}>
								<input
									type="number"
									min={1}
									max={999}
									value={shape().number}
									class="h-7 w-20 rounded-md bg-ed-ctl px-2 text-right text-xs tabular-nums text-ed-text-1 outline-hidden focus:ring-1 focus:ring-ed-accent"
									onInput={(event) => {
										const parsed = Number.parseInt(
											event.currentTarget.value,
											10,
										);
										if (Number.isFinite(parsed) && parsed >= 1) {
											setProject(
												"timeline",
												"shapeSegments",
												props.index,
												"number",
												Math.min(999, parsed),
											);
										}
									}}
								/>
							</Field>
						</Show>
					</div>

					<div class="flex flex-col gap-2.5 rounded-lg bg-ed-card-2 p-3">
						<SectionLabel name={localize("Stroke & Fill")} />
						<div class="flex items-center justify-between gap-2">
							<span class="text-xs text-ed-text-2">
								{localize("Stroke color")}
							</span>
							<div class="flex items-center gap-1">
								<For each={SHAPE_COLOR_SWATCHES}>
									{(swatch) => (
										<button
											type="button"
											aria-label={swatch}
											class={cx(
												"size-4 rounded-full border transition-transform",
												shape().strokeColor.toUpperCase() === swatch
													? "scale-110 border-ed-accent ring-1 ring-ed-accent"
													: "border-ed-line",
											)}
											style={{ "background-color": swatch }}
											onClick={() =>
												setProject(
													"timeline",
													"shapeSegments",
													props.index,
													"strokeColor",
													swatch,
												)
											}
										/>
									)}
								</For>
								<input
									type="color"
									aria-label={localize("Stroke color")}
									value={shape().strokeColor}
									class="h-5 w-6 cursor-pointer rounded border border-ed-line bg-transparent p-0"
									onInput={(event) =>
										setProject(
											"timeline",
											"shapeSegments",
											props.index,
											"strokeColor",
											event.currentTarget.value,
										)
									}
								/>
							</div>
						</div>

						<Field
							inline
							name={localize("Stroke width")}
							value={`${Math.round(shape().strokeWidth)}px`}
						>
							<Slider
								value={[shape().strokeWidth]}
								minValue={0}
								maxValue={40}
								step={1}
								formatTooltip="px"
								onChange={(value) =>
									setProject(
										"timeline",
										"shapeSegments",
										props.index,
										"strokeWidth",
										value[0],
									)
								}
							/>
						</Field>

						<Show when={shapeKindSupportsFill(shape().kind)}>
							<Field inline name={localize("Fill")}>
								<Toggle
									checked={shape().fill}
									onChange={(value) =>
										setProject(
											"timeline",
											"shapeSegments",
											props.index,
											"fill",
											value,
										)
									}
								/>
							</Field>
							<Show when={shape().fill}>
								<div class="flex items-center justify-between gap-2">
									<span class="text-xs text-ed-text-2">
										{localize("Fill color")}
									</span>
									<div class="flex items-center gap-1">
										<For each={SHAPE_COLOR_SWATCHES}>
											{(swatch) => (
												<button
													type="button"
													aria-label={swatch}
													class={cx(
														"size-4 rounded-full border transition-transform",
														shape().fillColor.toUpperCase() === swatch
															? "scale-110 border-ed-accent ring-1 ring-ed-accent"
															: "border-ed-line",
													)}
													style={{ "background-color": swatch }}
													onClick={() =>
														setProject(
															"timeline",
															"shapeSegments",
															props.index,
															"fillColor",
															swatch,
														)
													}
												/>
											)}
										</For>
										<input
											type="color"
											aria-label={localize("Fill color")}
											value={shape().fillColor}
											class="h-5 w-6 cursor-pointer rounded border border-ed-line bg-transparent p-0"
											onInput={(event) =>
												setProject(
													"timeline",
													"shapeSegments",
													props.index,
													"fillColor",
													event.currentTarget.value,
												)
											}
										/>
									</div>
								</div>
								<Field
									inline
									name={localize("Fill opacity")}
									value={`${Math.round(shape().fillOpacity * 100)}%`}
								>
									<Slider
										value={[Math.round(shape().fillOpacity * 100)]}
										minValue={0}
										maxValue={100}
										step={1}
										formatTooltip="%"
										onChange={(value) =>
											setProject(
												"timeline",
												"shapeSegments",
												props.index,
												"fillOpacity",
												value[0] / 100,
											)
										}
									/>
								</Field>
							</Show>
						</Show>

						<Show when={shapeKindSupportsCornerRadius(shape().kind)}>
							<Field
								inline
								name={localize("Corner radius")}
								value={`${Math.round(shape().cornerRadius)}px`}
							>
								<Slider
									value={[shape().cornerRadius]}
									minValue={0}
									maxValue={200}
									step={1}
									formatTooltip="px"
									onChange={(value) =>
										setProject(
											"timeline",
											"shapeSegments",
											props.index,
											"cornerRadius",
											value[0],
										)
									}
								/>
							</Field>
						</Show>

						<Field
							inline
							name={localize("Opacity")}
							value={`${Math.round(shape().opacity * 100)}%`}
						>
							<Slider
								value={[Math.round(shape().opacity * 100)]}
								minValue={0}
								maxValue={100}
								step={1}
								formatTooltip="%"
								onChange={(value) =>
									setProject(
										"timeline",
										"shapeSegments",
										props.index,
										"opacity",
										value[0] / 100,
									)
								}
							/>
						</Field>

						<Field
							inline
							name={localize("Shadow")}
							value={`${Math.round(shape().shadow * 100)}%`}
						>
							<Slider
								value={[Math.round(shape().shadow * 100)]}
								minValue={0}
								maxValue={100}
								step={1}
								formatTooltip="%"
								onChange={(value) =>
									setProject(
										"timeline",
										"shapeSegments",
										props.index,
										"shadow",
										value[0] / 100,
									)
								}
							/>
						</Field>
					</div>

					<div class="flex flex-col gap-2.5 rounded-lg bg-ed-card-2 p-3">
						<SectionLabel name={localize("Animation")} />
						<div class="flex flex-col gap-1.5">
							<span class="text-[11px] font-medium text-ed-text-3">
								{localize("Entrance")}
							</span>
							<div class="grid grid-cols-4 gap-1">
								<For each={SHAPE_ANIMATIONS}>
									{(anim) => (
										<button
											type="button"
											class={cx(
												"h-7 rounded-md px-1.5 text-[11px] font-medium transition-colors",
												shape().animationIn === anim
													? "bg-ed-accent text-white"
													: "bg-ed-ctl text-ed-text-2 hover:bg-ed-ctl-hover hover:text-ed-text-1",
											)}
											onClick={() =>
												setProject(
													"timeline",
													"shapeSegments",
													props.index,
													"animationIn",
													anim,
												)
											}
										>
											{localize(shapeAnimationLabel(anim))}
										</button>
									)}
								</For>
							</div>
						</div>
						<div class="flex flex-col gap-1.5">
							<span class="text-[11px] font-medium text-ed-text-3">
								{localize("Exit")}
							</span>
							<div class="grid grid-cols-4 gap-1">
								<For each={SHAPE_ANIMATIONS}>
									{(anim) => (
										<button
											type="button"
											class={cx(
												"h-7 rounded-md px-1.5 text-[11px] font-medium transition-colors",
												shape().animationOut === anim
													? "bg-ed-accent text-white"
													: "bg-ed-ctl text-ed-text-2 hover:bg-ed-ctl-hover hover:text-ed-text-1",
											)}
											onClick={() =>
												setProject(
													"timeline",
													"shapeSegments",
													props.index,
													"animationOut",
													anim,
												)
											}
										>
											{localize(shapeAnimationLabel(anim))}
										</button>
									)}
								</For>
							</div>
						</div>
					</div>

					<div class="flex flex-col gap-2 rounded-lg bg-ed-card-2 p-3">
						<SectionLabel name={localize("Position")} />
						<Field
							inline
							name={localize("Start X")}
							value={`${Math.round(shape().from.x * 100)}%`}
						>
							<Slider
								value={[Math.round(shape().from.x * 100)]}
								minValue={0}
								maxValue={100}
								step={1}
								formatTooltip="%"
								onChange={(value) =>
									setProject(
										"timeline",
										"shapeSegments",
										props.index,
										"from",
										"x",
										value[0] / 100,
									)
								}
							/>
						</Field>
						<Field
							inline
							name={localize("Start Y")}
							value={`${Math.round(shape().from.y * 100)}%`}
						>
							<Slider
								value={[Math.round(shape().from.y * 100)]}
								minValue={0}
								maxValue={100}
								step={1}
								formatTooltip="%"
								onChange={(value) =>
									setProject(
										"timeline",
										"shapeSegments",
										props.index,
										"from",
										"y",
										value[0] / 100,
									)
								}
							/>
						</Field>
						<Field
							inline
							name={localize("End X")}
							value={`${Math.round(shape().to.x * 100)}%`}
						>
							<Slider
								value={[Math.round(shape().to.x * 100)]}
								minValue={0}
								maxValue={100}
								step={1}
								formatTooltip="%"
								onChange={(value) =>
									setProject(
										"timeline",
										"shapeSegments",
										props.index,
										"to",
										"x",
										value[0] / 100,
									)
								}
							/>
						</Field>
						<Field
							inline
							name={localize("End Y")}
							value={`${Math.round(shape().to.y * 100)}%`}
						>
							<Slider
								value={[Math.round(shape().to.y * 100)]}
								minValue={0}
								maxValue={100}
								step={1}
								formatTooltip="%"
								onChange={(value) =>
									setProject(
										"timeline",
										"shapeSegments",
										props.index,
										"to",
										"y",
										value[0] / 100,
									)
								}
							/>
						</Field>
						<EditorButton
							class="w-full justify-center"
							leftIcon={<IconLucideCrosshair class="size-4" />}
							onClick={centerOnCanvas}
						>
							{localize("Center on canvas")}
						</EditorButton>
					</div>
				</div>
			)}
		</Show>
	);
}
