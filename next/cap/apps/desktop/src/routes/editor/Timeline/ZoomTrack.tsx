import { Menu } from "@tauri-apps/api/menu";
import {
	batch,
	createEffect,
	createMemo,
	createSignal,
	For,
	onCleanup,
	Show,
} from "solid-js";
import { produce, unwrap } from "solid-js/store";
import toast from "solid-toast";
import { generalSettingsStore } from "~/store";
import { t as localize } from "~/utils/i18n";
import { commands, type ZoomSegment } from "~/utils/tauri";
import { createAutoZoomGeneration } from "../auto-zoom-generation";
import { serializeProjectConfiguration, useEditorContext } from "../context";
import { useTimelineContext, useTrackContext } from "./context";
import { createTimelineMouseDrag } from "./mouse-drag";
import {
	SegmentContent,
	SegmentHandle,
	SegmentLabel,
	SegmentRoot,
	TrackRoot,
	useSegmentVisibleBox,
	useSetPreviewTime,
} from "./Track";

export type ZoomSegmentDragState =
	| { type: "idle" }
	| { type: "movePending" }
	| { type: "moving" };

const MIN_ZOOM_SEGMENT_PIXEL_WIDTH = 40;
const MIN_NEW_SEGMENT_PIXEL_WIDTH = 80;
const MIN_NEW_SEGMENT_SECS_WIDTH = 1;
const NO_AUTO_ZOOM_CLICKS_MESSAGE =
	"未检测到可缩放的点击操作。拖动轨道即可添加缩放片段。";

export function ZoomTrack(props: {
	onDragStateChanged: (v: ZoomSegmentDragState) => void;
	handleUpdatePlayhead: (e: MouseEvent) => void;
}) {
	const {
		project,
		setProject,
		projectHistory,
		setEditorState,
		editorState,
		totalDuration,
		projectActions,
		meta,
		flushProjectConfig,
		projectRevision,
	} = useEditorContext();

	const { duration, secsPerPixel } = useTimelineContext();
	const setPreviewTime = useSetPreviewTime();
	const generalSettings = generalSettingsStore.createQuery();

	const [creatingSegmentViaDrag, setCreatingSegmentViaDrag] =
		createSignal(false);
	const [isGeneratingAutoZoom, setIsGeneratingAutoZoom] = createSignal(false);
	const [isHoveringGenerateZoomButton, setIsHoveringGenerateZoomButton] =
		createSignal(false);
	const [
		sessionDismissedGenerateZoomPrompt,
		setSessionDismissedGenerateZoomPrompt,
	] = createSignal(false);

	const hasZoomSegments = () =>
		(project.timeline?.zoomSegments?.length ?? 0) > 0;
	const selectedZoomIndices = createMemo(() => {
		const selection = editorState.timeline.selection;
		if (!selection || selection.type !== "zoom") return null;
		return new Set(selection.indices);
	});

	const hasRecordedCursorData = () => meta().hasRecordedCursorData;

	createEffect(() => {
		if (hasZoomSegments() || sessionDismissedGenerateZoomPrompt()) {
			setIsHoveringGenerateZoomButton(false);
		}
	});

	const generation = createAutoZoomGeneration({
		snapshot: () => JSON.stringify(serializeProjectConfiguration(project)),
		revision: projectRevision,
		flush: flushProjectConfig,
		generate: () => commands.generateZoomSegmentsFromClicks(),
		apply: (segments) => setProject("timeline", "zoomSegments", segments),
		setPending: setIsGeneratingAutoZoom,
		onEmpty: () => toast.error(localize(NO_AUTO_ZOOM_CLICKS_MESSAGE)),
		onStale: () =>
			toast.error(localize("编辑内容已变化，请重新生成自动缩放。")),
		onError: (error) => {
			console.error("Failed to generate zoom segments:", error);
			toast.error(localize("Failed to generate zoom segments"));
		},
	});
	onCleanup(generation.dispose);
	const handleGenerateZoomSegments = generation.run;

	const newSegmentMinDuration = () =>
		Math.max(
			MIN_NEW_SEGMENT_PIXEL_WIDTH * secsPerPixel(),
			MIN_NEW_SEGMENT_SECS_WIDTH,
		);

	const zoomSegments = () => project.timeline?.zoomSegments ?? [];
	const startGesture = createTimelineMouseDrag();
	const writeZoom = (
		item: ZoomSegment,
		changes: Partial<Pick<ZoomSegment, "start" | "end">>,
	) => {
		const index = zoomSegments().indexOf(item);
		if (index < 0) return;
		const start = changes.start ?? item.start;
		const end = changes.end ?? item.end;
		if (start === item.start && end === item.end) return;
		const selection = editorState.timeline.selection;
		const selected =
			selection?.type === "zoom"
				? selection.indices.map((value) => zoomSegments()[value])
				: undefined;
		batch(() => {
			setProject(
				"timeline",
				"zoomSegments",
				produce((items) => {
					const target = items[index];
					if (!target) return;
					target.start = start;
					target.end = end;
					items.sort((left, right) => left.start - right.start);
				}),
			);
			if (selected && selection?.type === "zoom") {
				const indices = selected
					.map((value) => zoomSegments().indexOf(value))
					.filter((value) => value >= 0);
				if (
					indices.length !== selection.indices.length ||
					indices.some(
						(value, position) => value !== selection.indices[position],
					)
				)
					setEditorState(
						"timeline",
						"selection",
						indices.length ? { type: "zoom", indices } : null,
					);
			}
		});
	};
	const newSegmentDetails = () => {
		const time = editorState.previewTime;
		if (
			creatingSegmentViaDrag() ||
			editorState.timeline.hoveredTrack !== "zoom" ||
			time === null ||
			time < 0 ||
			time > totalDuration()
		)
			return;
		let min = 0;
		let max = totalDuration();
		for (const item of zoomSegments()) {
			if (time >= item.start && time < item.end) return;
			if (item.end <= time) min = Math.max(min, item.end);
			if (item.start >= time) max = Math.min(max, item.start);
		}
		const minDuration = newSegmentMinDuration();
		if (max - min < minDuration) return;
		const start = Math.max(min, Math.min(time, max - minDuration));
		return { start, end: start + minDuration, max };
	};
	const handleLaneMouseDown = (event: MouseEvent) => {
		if (event.button !== 0 || editorState.timeline.interactMode !== "seek")
			return;
		event.stopPropagation();
		const base = newSegmentDetails();
		startGesture(() => {
			if (!base) return null;
			const scale = secsPerPixel();
			const span = totalDuration();
			const timelineDuration = duration();
			const occupied = zoomSegments().map((item) => ({
				item,
				start: item.start,
				end: item.end,
			}));
			let created: ZoomSegment | undefined;
			let expectedEnd = base.end;
			let resumeHistory: (() => void) | undefined;
			let moved = false;
			const createdItem = () =>
				zoomSegments().find((item) => unwrap(item) === created);
			const writeEnd = (end: number) => {
				expectedEnd = end;
				if (!created) {
					resumeHistory = projectHistory.pause();
					created = {
						start: base.start,
						end,
						amount: generalSettings.data?.defaultZoomAmount ?? 1.5,
						mode: "auto",
					};
					const value = created;
					batch(() => {
						setProject("timeline", "zoomSegments", (items) => items ?? []);
						setProject(
							"timeline",
							"zoomSegments",
							produce((items) => {
								items.push(value);
								items.sort((left, right) => left.start - right.start);
							}),
						);
						setEditorState("timeline", "selection", {
							type: "zoom",
							indices: [
								zoomSegments().findIndex((item) => unwrap(item) === value),
							],
						});
						setCreatingSegmentViaDrag(true);
					});
				} else {
					const item = createdItem();
					if (item) writeZoom(item, { end });
				}
			};
			props.onDragStateChanged({ type: "movePending" });
			return {
				isValid: () =>
					editorState.timeline.interactMode === "seek" &&
					secsPerPixel() === scale &&
					totalDuration() === span &&
					duration() === timelineDuration &&
					zoomSegments().length === occupied.length + (created ? 1 : 0) &&
					occupied.every(
						(value) =>
							zoomSegments().includes(value.item) &&
							value.item.start === value.start &&
							value.item.end === value.end,
					) &&
					(!created ||
						(createdItem()?.start === base.start &&
							createdItem()?.end === expectedEnd)),
				update: (moveEvent: MouseEvent) => {
					if (!moved) {
						if (Math.abs(moveEvent.clientX - event.clientX) <= 2) return;
						moved = true;
						props.onDragStateChanged({ type: "moving" });
					}
					writeEnd(
						Math.min(
							base.max,
							Math.max(
								base.end,
								base.start + (moveEvent.clientX - event.clientX) * scale,
							),
						),
					);
				},
				finish: (upEvent?: MouseEvent) => {
					if (upEvent && !created) writeEnd(base.end);
					resumeHistory?.();
					setCreatingSegmentViaDrag(false);
					props.onDragStateChanged({ type: "idle" });
				},
			};
		});
	};

	return (
		<TrackRoot
			onMouseEnter={() => setEditorState("timeline", "hoveredTrack", "zoom")}
			onMouseLeave={() => setEditorState("timeline", "hoveredTrack", null)}
			onContextMenu={async (e) => {
				startGesture(() => null);
				if (!import.meta.env.DEV) return;

				e.preventDefault();
				const menu = await Menu.new({
					id: "zoom-track-options",
					items: [
						{
							id: "generateZoomSegments",
							text: localize("根据点击自动添加缩放片段"),
							action: handleGenerateZoomSegments,
						},
					],
				});
				menu.popup();
			}}
			onMouseDown={handleLaneMouseDown}
		>
			<Show
				when={hasZoomSegments()}
				fallback={
					<div class="cap-empty-lane relative z-1 isolate pointer-events-auto">
						<Show
							when={
								hasRecordedCursorData() && !sessionDismissedGenerateZoomPrompt()
							}
							fallback={
								<span>{localize("Drag across this lane to add a zoom")}</span>
							}
						>
							<div
								class="relative z-10 flex items-center gap-1.5"
								onMouseEnter={() => setIsHoveringGenerateZoomButton(true)}
								onMouseLeave={() => setIsHoveringGenerateZoomButton(false)}
								onMouseDown={(e) => {
									e.stopPropagation();
									startGesture(() => null);
								}}
							>
								<span>{localize("Generate zoom segments automatically")}</span>
								<button
									type="button"
									class="cap-empty-lane-action outline-hidden"
									disabled={isGeneratingAutoZoom()}
									onClick={() => {
										void handleGenerateZoomSegments();
									}}
								>
									·{" "}
									{isGeneratingAutoZoom()
										? localize("Generating...")
										: localize("Generate")}
								</button>
								<button
									type="button"
									class="flex shrink-0 justify-center items-center rounded-md outline-hidden text-ed-text-3 hover:text-ed-text-1 hover:bg-ed-ctl-hover size-5 transition-colors"
									disabled={isGeneratingAutoZoom()}
									aria-label={localize("Dismiss for this session")}
									onClick={() => setSessionDismissedGenerateZoomPrompt(true)}
								>
									<IconLucideX class="size-3" />
								</button>
							</div>
						</Show>
					</div>
				}
			>
				<For each={zoomSegments()}>
					{(item) => {
						const segment = () => item;
						const index = () => zoomSegments().indexOf(item);
						const { setTrackState } = useTrackContext();

						const zoomPercentage = () => {
							const amount = segment().amount;
							return `${amount.toFixed(1)}x`;
						};

						const zoomModeLabel = () =>
							segment().mode === "auto"
								? localize("自动缩放")
								: localize("手动缩放");

						const fillStart = () => {
							startGesture(() => null);
							let minValue = 0;
							for (const other of zoomSegments())
								if (other !== item && other.end <= item.start)
									minValue = Math.max(minValue, other.end);
							writeZoom(item, { start: minValue });
							setPreviewTime(minValue);
						};
						const fillEnd = () => {
							startGesture(() => null);
							let maxValue = totalDuration();
							for (const other of zoomSegments())
								if (other !== item && other.start >= item.end)
									maxValue = Math.min(maxValue, other.start);
							writeZoom(item, { end: maxValue });
							setPreviewTime(maxValue);
						};

						function createMouseDownDrag<T>(
							setup: () => T,
							_update: (
								event: MouseEvent,
								value: T,
								initialMouseX: number,
							) => Partial<Pick<ZoomSegment, "start" | "end">> & {
								previewTime?: number;
							},
						) {
							return (downEvent: MouseEvent) => {
								if (
									downEvent.button !== 0 ||
									editorState.timeline.interactMode !== "seek"
								)
									return;
								downEvent.stopPropagation();
								startGesture(() => {
									const initial = setup();
									const scale = secsPerPixel();
									const span = totalDuration();
									const timelineDuration = duration();
									let expectedStart = item.start;
									let expectedEnd = item.end;
									let moved = false;
									let resumeHistory: (() => void) | undefined;
									setTrackState("draggingSegment", true);
									props.onDragStateChanged({ type: "movePending" });
									function finish(e?: MouseEvent) {
										resumeHistory?.();
										if (!moved && e) {
											e.stopPropagation();

											const currentSelection = editorState.timeline.selection;
											const segmentIndex = index();
											const isMultiSelect = e.ctrlKey || e.metaKey;
											const isRangeSelect = e.shiftKey;

											if (isRangeSelect && currentSelection?.type === "zoom") {
												const existingIndices = currentSelection.indices;
												const lastIndex =
													existingIndices[existingIndices.length - 1];
												const start = Math.min(lastIndex, segmentIndex);
												const end = Math.max(lastIndex, segmentIndex);
												const rangeIndices: number[] = [];
												for (let idx = start; idx <= end; idx++) {
													rangeIndices.push(idx);
												}

												setEditorState("timeline", "selection", {
													type: "zoom",
													indices: rangeIndices,
												});
											} else if (isMultiSelect) {
												if (currentSelection?.type === "zoom") {
													const baseIndices = currentSelection.indices;
													const exists = baseIndices.includes(segmentIndex);
													const newIndices = exists
														? baseIndices.filter((idx) => idx !== segmentIndex)
														: [...baseIndices, segmentIndex];

													if (newIndices.length > 0) {
														setEditorState("timeline", "selection", {
															type: "zoom",
															indices: newIndices,
														});
													} else {
														setEditorState("timeline", "selection", null);
													}
												} else {
													setEditorState("timeline", "selection", {
														type: "zoom",
														indices: [segmentIndex],
													});
												}
											} else {
												setEditorState("timeline", "selection", {
													type: "zoom",
													indices: [segmentIndex],
												});
											}
											props.handleUpdatePlayhead(e);
										}
										props.onDragStateChanged({ type: "idle" });
										setTrackState("draggingSegment", false);
									}
									return {
										isValid: () =>
											editorState.timeline.interactMode === "seek" &&
											zoomSegments().includes(item) &&
											item.start === expectedStart &&
											item.end === expectedEnd &&
											secsPerPixel() === scale &&
											totalDuration() === span &&
											duration() === timelineDuration,
										update: (event: MouseEvent) => {
											if (!moved) {
												if (Math.abs(event.clientX - downEvent.clientX) <= 2)
													return;
												moved = true;
												props.onDragStateChanged({ type: "moving" });
											}
											const { previewTime, ...changes } = _update(
												event,
												initial,
												downEvent.clientX,
											);
											if (
												(changes.start ?? item.start) !== item.start ||
												(changes.end ?? item.end) !== item.end
											) {
												resumeHistory ??= projectHistory.pause();
												expectedStart = changes.start ?? item.start;
												expectedEnd = changes.end ?? item.end;
												writeZoom(item, changes);
											}
											if (previewTime !== undefined)
												setPreviewTime(previewTime);
										},
										finish,
									};
								});
							};
						}

						const isSelected = createMemo(() => {
							const indices = selectedZoomIndices();
							if (!indices) return false;
							return indices.has(index());
						});

						return (
							<SegmentRoot
								segColor="var(--track-zoom)"
								class="group"
								selected={isSelected()}
								title={`${zoomModeLabel()} · ${zoomPercentage()}`}
								segment={segment()}
								onMouseDown={(e) => {
									e.stopPropagation();
									if (e.button !== 0) return;
									startGesture(() => null);

									if (editorState.timeline.interactMode === "split") {
										const rect = e.currentTarget.getBoundingClientRect();
										const fraction = (e.clientX - rect.left) / rect.width;

										const splitTime =
											fraction * (segment().end - segment().start);

										projectActions.splitZoomSegment(index(), splitTime);
									}
								}}
								onContextMenu={async (e: MouseEvent) => {
									e.preventDefault();
									e.stopPropagation();
									// Native menus can consume mouseup before deleting the dragged segment.
									startGesture(() => null);

									// Right-clicking an unselected segment selects it first,
									// so the menu always acts on what's highlighted.
									const selection = editorState.timeline.selection;
									const targetIndices =
										selection?.type === "zoom" &&
										selection.indices.includes(index())
											? [...selection.indices]
											: [index()];
									if (
										targetIndices.length === 1 &&
										!selectedZoomIndices()?.has(index())
									)
										setEditorState("timeline", "selection", {
											type: "zoom",
											indices: [index()],
										});

									const targets = targetIndices
										.map((value) => zoomSegments()[value])
										.filter(
											(value): value is ZoomSegment => value !== undefined,
										);

									const menu = await Menu.new({
										id: "zoom-segment-options",
										items: [
											{
												id: "selectAllZoomSegments",
												text: localize("全选缩放片段"),
												enabled: zoomSegments().length > 1,
												action: () =>
													setEditorState("timeline", "selection", {
														type: "zoom",
														indices: zoomSegments().map((_, value) => value),
													}),
											},
											{
												id: "deleteZoomSegments",
												text:
													targetIndices.length > 1
														? localize("删除 {count} 个缩放片段", {
																count: targetIndices.length,
															})
														: localize("删除缩放片段"),
												action: () =>
													projectActions.deleteZoomSegments(
														targets
															.map((value) => zoomSegments().indexOf(value))
															.filter((value) => value >= 0),
													),
											},
										],
									});
									menu.popup();
								}}
							>
								<SegmentHandle
									position="start"
									onDblClick={(e) => {
										e.stopPropagation();
										fillStart();
									}}
									onMouseDown={createMouseDownDrag(
										() => {
											const start = segment().start;
											const minDuration = Math.max(
												1,
												secsPerPixel() * MIN_ZOOM_SEGMENT_PIXEL_WIDTH,
											);

											let minValue = 0;

											const maxValue = segment().end - minDuration;

											for (let j = zoomSegments().length - 1; j >= 0; j--) {
												const other = zoomSegments()[j];
												if (!other) continue;
												if (other.end <= start) {
													minValue = other.end;
													break;
												}
											}

											return { start, minValue, maxValue };
										},
										(e, value, initialMouseX) => {
											const newStart =
												value.start +
												(e.clientX - initialMouseX) * secsPerPixel();
											const nextStart = Math.min(
												value.maxValue,
												Math.max(value.minValue, newStart),
											);

											return { start: nextStart, previewTime: nextStart };
										},
									)}
								/>
								<SegmentContent
									class="flex items-center cursor-grab"
									onMouseDown={createMouseDownDrag(
										() => {
											const original = { ...segment() };

											const prevSegment = zoomSegments()[index() - 1];
											const nextSegment = zoomSegments()[index() + 1];

											const minStart = prevSegment?.end ?? 0;
											const maxEnd = nextSegment?.start ?? duration();

											return {
												original,
												minStart,
												maxEnd,
											};
										},
										(e, value, initialMouseX) => {
											const rawDelta =
												(e.clientX - initialMouseX) * secsPerPixel();

											const newStart = value.original.start + rawDelta;
											const newEnd = value.original.end + rawDelta;

											let delta = rawDelta;

											if (newStart < value.minStart)
												delta = value.minStart - value.original.start;
											else if (newEnd > value.maxEnd)
												delta = value.maxEnd - value.original.end;

											return {
												start: value.original.start + delta,
												end: value.original.end + delta,
											};
										},
									)}
								>
									{(() => {
										const visibleBox = useSegmentVisibleBox();

										return (
											<SegmentLabel
												full={() => (
													<div class="cap-seg-labels animate-in fade-in">
														<span class="cap-seg-label truncate">
															{visibleBox().width >= 140
																? zoomModeLabel()
																: localize("Zoom")}
														</span>
														<span class="cap-seg-sublabel">
															{zoomPercentage()}
														</span>
													</div>
												)}
												compact={() => (
													<div class="cap-seg-labels">
														<span class="cap-seg-label">
															{localize("Zoom")}
														</span>
														<span class="cap-seg-sublabel">
															{zoomPercentage()}
														</span>
													</div>
												)}
												glyph={() => (
													<div class="flex justify-center items-center">
														<IconLucideSearch class="size-3.5 cap-seg-label" />
													</div>
												)}
											/>
										);
									})()}
								</SegmentContent>
								<SegmentHandle
									position="end"
									onDblClick={(e) => {
										e.stopPropagation();
										fillEnd();
									}}
									onMouseDown={createMouseDownDrag(
										() => {
											const end = segment().end;
											const minDuration = Math.max(
												1,
												secsPerPixel() * MIN_ZOOM_SEGMENT_PIXEL_WIDTH,
											);

											const minValue = segment().start + minDuration;

											let maxValue = duration();

											for (let j = 0; j < zoomSegments().length; j++) {
												const other = zoomSegments()[j];
												if (!other) continue;
												if (other !== item && other.start >= end) {
													maxValue = other.start;
													break;
												}
											}

											return { end, minValue, maxValue };
										},
										(e, value, initialMouseX) => {
											const newEnd =
												value.end +
												(e.clientX - initialMouseX) * secsPerPixel();
											const nextEnd = Math.min(
												value.maxValue,
												Math.max(value.minValue, newEnd),
											);

											return { end: nextEnd, previewTime: nextEnd };
										},
									)}
								/>
							</SegmentRoot>
						);
					}}
				</For>
			</Show>
			<Show
				when={
					!isHoveringGenerateZoomButton() &&
					!useTrackContext().trackState.draggingSegment &&
					newSegmentDetails()
				}
			>
				{(details) => (
					<SegmentRoot
						class="pointer-events-none z-0"
						ghost
						segColor="var(--track-zoom)"
						segment={details()}
					>
						<SegmentContent class="group justify-center">
							<p class="cap-seg-label">+</p>
						</SegmentContent>
					</SegmentRoot>
				)}
			</Show>
		</TrackRoot>
	);
}
