import { createEventListener } from "@solid-primitives/event-listener";
import {
	batch,
	createMemo,
	createSignal,
	For,
	onCleanup,
	Show,
} from "solid-js";
import { produce } from "solid-js/store";
import { t as localize } from "~/utils/i18n";
import { useEditorContext } from "../context";
import {
	type Camera3DSegment,
	camera3DShotLabel,
	DEFAULT_CAMERA3D_SHOT_DURATION,
	fitCamera3DMotionToSegment,
	MAX_AUTO_CAMERA3D_SHOTS,
	maxAutoCamera3DShots,
	placeCamera3DShot,
} from "../three-d";
import { ShotCountPills } from "../three-d-panel";
import { useTimelineContext, useTrackContext } from "./context";
import {
	createTimelineMouseDrag,
	type TimelineMouseDragEndCause,
	type TimelineMouseDragEndReason,
} from "./mouse-drag";
import {
	createOrderedTimelineRangeDrag,
	sameTimelineRange,
	type TimelineRangeEdge,
} from "./range-snapping";
import {
	SegmentContent,
	SegmentHandle,
	SegmentLabel,
	SegmentRoot,
	TrackRoot,
	useSegmentTranslateX,
	useSegmentVisibleBox,
	useSegmentWidth,
	useSetPreviewTime,
} from "./Track";

export type ThreeDSegmentDragState =
	| { type: "idle" }
	| { type: "movePending" }
	| { type: "moving" };

const MIN_THREE_D_SEGMENT_PIXEL_WIDTH = 40;
const MIN_NEW_SHOT_SECS = 1;
/** Below this the ghost has no room for words and shows a bare "+". */
const GHOST_LABEL_PX = 96;
const GHOST_FULL_LABEL_PX = 200;

export function ThreeDTrack(props: {
	onDragStateChanged: (v: ThreeDSegmentDragState) => void;
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
		camera3DAutoScenePreview,
	} = useEditorContext();

	const { duration, secsPerPixel, snapping } = useTimelineContext();
	const setPreviewTime = useSetPreviewTime();

	// The range being drawn by a drag on empty lane space. While it is set the
	// ghost shows the drawn range instead of the one under the cursor.
	const [dragRange, setDragRange] = createSignal<{
		start: number;
		end: number;
	} | null>(null);

	const camera3dSegments = () => project.timeline?.camera3dSegments ?? [];
	const hasCamera3DSegments = () => camera3dSegments().length > 0;

	// The empty lane's "Auto scene" chip opens in place rather than in a dialog,
	// so the counts sit right above the track they are about to fill.
	const [pickerOpen, setPickerOpen] = createSignal(false);
	const maxShots = () => maxAutoCamera3DShots(totalDuration());

	const previewShotCount = (count: number | null) =>
		setEditorState("timeline", "camera3dAutoPreview", count);

	const closePicker = () => {
		setPickerOpen(false);
		previewShotCount(null);
	};

	const pickShotCount = (count: number) => {
		closePicker();
		projectActions.applyCamera3DAutoScene(count);
	};

	onCleanup(() => previewShotCount(null));

	createEventListener(window, "keydown", (e) => {
		// The picker only exists on an empty lane: a shot landing there while it
		// is open takes the shortcuts with it.
		if (!pickerOpen() || hasCamera3DSegments()) return;
		if (
			document.activeElement instanceof HTMLInputElement ||
			document.activeElement instanceof HTMLTextAreaElement
		)
			return;
		if (e.key === "Escape") {
			closePicker();
			return;
		}
		if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
		const count = Number.parseInt(e.key, 10);
		if (
			!Number.isInteger(count) ||
			count < 1 ||
			count > MAX_AUTO_CAMERA3D_SHOTS
		)
			return;
		if (count > maxShots()) return;
		e.preventDefault();
		pickShotCount(count);
	});

	const selectedCamera3DIndices = createMemo(() => {
		const selection = editorState.timeline.selection;
		if (!selection || selection.type !== "3d") return null;
		return new Set(selection.indices);
	});

	// The range a shot dropped at the cursor would take. Also drives the drag,
	// so what the ghost promises is exactly what a drag starts from. Over an
	// existing shot there is nothing to offer: that click selects instead, and
	// a ghost hovering somewhere else on the lane would only mislead.
	const newShotDetails = () => {
		const time = editorState.previewTime;
		if (editorState.timeline.hoveredTrack !== "3d" || time === null)
			return null;
		if (
			camera3dSegments().some(
				(segment) => time >= segment.start && time < segment.end,
			)
		)
			return null;
		return placeCamera3DShot(
			camera3dSegments(),
			time,
			DEFAULT_CAMERA3D_SHOT_DURATION,
			totalDuration(),
		);
	};

	// How far right a drag from `start` may run before it hits the next shot.
	const gapEndAfter = (start: number) => {
		let end = totalDuration();
		for (const segment of camera3dSegments())
			if (segment.start >= start) end = Math.min(end, segment.start);
		return end;
	};

	const startGesture = createTimelineMouseDrag();

	const stopControlDrag = (event: MouseEvent) => {
		event.stopPropagation();
		if (event.button === 0) startGesture(() => null);
	};

	const writeShot = (
		shot: Camera3DSegment,
		changes: Partial<Pick<Camera3DSegment, "start" | "end">>,
	) => {
		const index = camera3dSegments().indexOf(shot);
		if (index < 0) return;
		const start = changes.start ?? shot.start;
		const end = changes.end ?? shot.end;
		if (start === shot.start && end === shot.end) return;
		const selection = editorState.timeline.selection;
		const selected =
			selection?.type === "3d"
				? selection.indices.map((value) => camera3dSegments()[value])
				: undefined;
		batch(() => {
			setProject(
				"timeline",
				"camera3dSegments",
				produce((items) => {
					const target = items[index];
					if (!target) return;
					target.start = start;
					target.end = end;
					fitCamera3DMotionToSegment(target);
					items.sort((left, right) => left.start - right.start);
				}),
			);
			if (selected && selection?.type === "3d") {
				const indices = selected
					.map((item) => camera3dSegments().indexOf(item))
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
						indices.length ? { type: "3d", indices } : null,
					);
			}
		});
	};

	const handleLaneMouseDown = (event: MouseEvent) => {
		if (event.button !== 0 || editorState.timeline.interactMode !== "seek")
			return;
		event.stopPropagation();
		const base = newShotDetails();
		if (!base) {
			startGesture(() => null);
			projectActions.addCamera3DShot(
				editorState.previewTime ?? editorState.playbackTime,
			);
			return;
		}
		startGesture(() => {
			const scale = secsPerPixel();
			const span = totalDuration();
			const occupied = camera3dSegments().map((shot) => ({
				shot,
				start: shot.start,
				end: shot.end,
			}));
			const maxEnd = Math.max(
				gapEndAfter(base.start),
				base.start + MIN_NEW_SHOT_SECS,
			);
			let moved = false;
			const rangeFor = (clientX: number) => ({
				start: base.start,
				end: Math.min(
					maxEnd,
					Math.max(
						base.start + MIN_NEW_SHOT_SECS,
						base.end + (clientX - event.clientX) * scale,
					),
				),
			});
			props.onDragStateChanged({ type: "movePending" });
			return {
				isValid: () =>
					editorState.timeline.interactMode === "seek" &&
					secsPerPixel() === scale &&
					totalDuration() === span &&
					camera3dSegments().length === occupied.length &&
					occupied.every(
						(value, index) =>
							camera3dSegments()[index] === value.shot &&
							value.shot.start === value.start &&
							value.shot.end === value.end,
					),
				update: (moveEvent: MouseEvent) => {
					if (!moved) {
						if (Math.abs(moveEvent.clientX - event.clientX) <= 2) return;
						moved = true;
						props.onDragStateChanged({ type: "moving" });
					}
					setDragRange(rangeFor(moveEvent.clientX));
				},
				finish: (upEvent?: MouseEvent) => {
					setDragRange(null);
					props.onDragStateChanged({ type: "idle" });
					if (upEvent) {
						const range = moved ? rangeFor(upEvent.clientX) : base;
						projectActions.addCamera3DShotRange(range.start, range.end);
					}
				},
			};
		});
	};

	return (
		<TrackRoot
			onMouseEnter={() => setEditorState("timeline", "hoveredTrack", "3d")}
			onMouseLeave={() => setEditorState("timeline", "hoveredTrack", null)}
			onMouseDown={handleLaneMouseDown}
		>
			<Show when={!hasCamera3DSegments()}>
				<div class="cap-empty-lane relative z-1 isolate pointer-events-auto">
					<Show
						when={pickerOpen()}
						fallback={
							<>
								<span>
									{localize("Add cinematic 3D shots to your recording")}
								</span>
								<div
									class="flex relative z-10 gap-2 items-center"
									onMouseDown={stopControlDrag}
								>
									<button
										type="button"
										class="cap-lane-chip outline-hidden"
										onClick={() => setPickerOpen(true)}
									>
										{localize("Auto scene")}
									</button>
									<button
										type="button"
										class="cap-lane-chip cap-lane-chip-ghost outline-hidden"
										onClick={() => projectActions.addCamera3DShot()}
									>
										+ {localize("Add shot")}
									</button>
								</div>
							</>
						}
					>
						<span>{localize("How many shots?")}</span>
						<div
							class="flex relative z-10 gap-1 items-center"
							onMouseDown={stopControlDrag}
						>
							<ShotCountPills
								max={maxShots()}
								onHover={previewShotCount}
								onPick={pickShotCount}
							/>
							<button
								type="button"
								aria-label={localize("Close the shot picker")}
								class="flex justify-center items-center ml-1 rounded-md transition-colors outline-hidden text-ed-text-3 hover:text-ed-text-1 hover:bg-ed-ctl-hover size-5"
								onClick={() => closePicker()}
							>
								<IconLucideX class="size-3" />
							</button>
							<button
								type="button"
								class="ml-1 cap-lane-chip cap-lane-chip-ghost outline-hidden"
								onClick={() => projectActions.addCamera3DShot()}
							>
								+ {localize("Add shot")}
							</button>
						</div>
					</Show>
				</div>
			</Show>
			<For each={camera3dSegments()}>
				{(item) => {
					const segment = () => item;
					const index = () => camera3dSegments().indexOf(item);
					const { setTrackState } = useTrackContext();

					const shotLabel = () => localize(camera3DShotLabel(segment()));
					const shotDuration = () =>
						localize("{seconds} 秒", {
							seconds: (segment().end - segment().start).toFixed(1),
						});

					// Double-clicking a handle expands the segment as far as it can go
					// in that direction (up to the neighbouring segment / timeline edge).
					const fillStart = () => {
						const segs = camera3dSegments();
						let minValue = 0;
						for (let j = segs.length - 1; j >= 0; j--) {
							const s = segs[j];
							if (s && s.end <= segment().start) {
								minValue = s.end;
								break;
							}
						}
						writeShot(item, { start: minValue });
						setPreviewTime(minValue);
					};

					const fillEnd = () => {
						const segs = camera3dSegments();
						let maxValue = totalDuration();
						for (let j = 0; j < segs.length; j++) {
							const s = segs[j];
							if (s && s.start >= segment().end) {
								maxValue = s.start;
								break;
							}
						}
						writeShot(item, { end: maxValue });
						setPreviewTime(maxValue);
					};

					function createMouseDownDrag(edge: TimelineRangeEdge) {
						return (downEvent: MouseEvent) => {
							if (
								downEvent.button !== 0 ||
								editorState.timeline.interactMode !== "seek"
							)
								return;
							downEvent.stopPropagation();
							startGesture(() => {
								const tracks = item.tracks;
								const properties = item.properties;
								const scale = secsPerPixel();
								const span = totalDuration();
								const timelineDuration = duration();
								const drag = createOrderedTimelineRangeDrag(
									snapping,
									item,
									edge,
									camera3dSegments(),
									duration(),
									Math.max(1, scale * MIN_THREE_D_SEGMENT_PIXEL_WIDTH),
									editorState.playbackTime,
								);
								let expected = drag.original;
								const previewBefore = editorState.previewTime;
								let lastPreview: number | undefined;
								const ownsRange = () =>
									camera3dSegments().includes(item) &&
									sameTimelineRange(item, expected) &&
									item.tracks === tracks &&
									item.properties === properties;
								let moved = false;
								let resumeHistory: (() => void) | undefined;
								setTrackState("draggingSegment", true);
								props.onDragStateChanged({ type: "movePending" });
								function finish(
									e?: MouseEvent,
									reason?: TimelineMouseDragEndReason,
									cause?: TimelineMouseDragEndCause,
								) {
									drag.clear();
									if (
										reason === "cancel" &&
										cause !== "superseded" &&
										ownsRange()
									) {
										if (!sameTimelineRange(item, drag.original))
											writeShot(item, drag.original);
										if (
											lastPreview !== undefined &&
											editorState.previewTime === lastPreview
										)
											setEditorState("previewTime", previewBefore);
									}
									resumeHistory?.();
									if (!moved && e) {
										e.stopPropagation();

										const currentSelection = editorState.timeline.selection;
										const segmentIndex = index();
										const isMultiSelect = e.ctrlKey || e.metaKey;
										const isRangeSelect = e.shiftKey;

										if (isRangeSelect && currentSelection?.type === "3d") {
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
												type: "3d",
												indices: rangeIndices,
											});
										} else if (isMultiSelect) {
											if (currentSelection?.type === "3d") {
												const baseIndices = currentSelection.indices;
												const exists = baseIndices.includes(segmentIndex);
												const newIndices = exists
													? baseIndices.filter((idx) => idx !== segmentIndex)
													: [...baseIndices, segmentIndex];

												if (newIndices.length > 0) {
													setEditorState("timeline", "selection", {
														type: "3d",
														indices: newIndices,
													});
												} else {
													setEditorState("timeline", "selection", null);
												}
											} else {
												setEditorState("timeline", "selection", {
													type: "3d",
													indices: [segmentIndex],
												});
											}
										} else {
											setEditorState("timeline", "selection", {
												type: "3d",
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
										ownsRange() &&
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
										const range = drag.edit(
											(event.clientX - downEvent.clientX) * scale,
											scale,
											event.altKey,
										);
										if (!sameTimelineRange(item, range)) {
											resumeHistory ??= projectHistory.pause();
											expected = range;
											writeShot(item, range);
										}
										if (edge !== "move") {
											lastPreview = range[edge];
											setPreviewTime(lastPreview);
										}
									},
									finish,
								};
							});
						};
					}

					const isSelected = createMemo(() => {
						const indices = selectedCamera3DIndices();
						if (!indices) return false;
						return indices.has(index());
					});

					return (
						<SegmentRoot
							menuTarget={{ type: "3d", index: index() }}
							segColor="var(--track-3d)"
							class="group"
							selected={isSelected()}
							title={localize("3D 镜头 · {name} · {duration}", {
								name: shotLabel(),
								duration: shotDuration(),
							})}
							segment={segment()}
							onMouseDown={(e) => {
								if (e.button !== 0) return;
								e.stopPropagation();
								startGesture(() => null);

								if (editorState.timeline.interactMode === "split") {
									const rect = e.currentTarget.getBoundingClientRect();
									const fraction = (e.clientX - rect.left) / rect.width;

									const splitTime =
										fraction * (segment().end - segment().start);

									projectActions.splitCamera3DSegment(index(), splitTime);
								}
							}}
						>
							<SegmentHandle
								position="start"
								onDblClick={(e) => {
									e.stopPropagation();
									fillStart();
								}}
								onMouseDown={createMouseDownDrag("start")}
							/>
							<SegmentContent
								class="flex items-center cursor-grab"
								onMouseDown={createMouseDownDrag("move")}
							>
								{(() => {
									const visibleBox = useSegmentVisibleBox();

									return (
										<SegmentLabel
											full={() => (
												<div class="cap-seg-labels animate-in fade-in">
													<span class="cap-seg-label truncate">
														{visibleBox().width >= 140
															? shotLabel()
															: shotLabel().split(" ")[0]}
													</span>
													<span class="cap-seg-sublabel">{shotDuration()}</span>
												</div>
											)}
											compact={() => (
												<div class="cap-seg-labels">
													<span class="cap-seg-label">
														{shotLabel().split(" ")[0]}
													</span>
												</div>
											)}
											glyph={() => (
												<div class="cap-seg-label flex justify-center items-center">
													<IconLucideRotate3d class="size-3.5" />
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
								onMouseDown={createMouseDownDrag("end")}
							/>
							{/* The two poses of the selected shot, on the shot itself:
							    the same control as the panel's pose cards. They sit
							    inside the resize handles, which keep the edge. */}
							<Show
								when={isSelected() && selectedCamera3DIndices()?.size === 1}
							>
								<For each={[false, true]}>
									{(end) => (
										<button
											type="button"
											aria-label={
												end
													? localize("编辑结束镜头")
													: localize("编辑开始镜头")
											}
											title={end ? localize("结束镜头") : localize("开始镜头")}
											class="cap-pose-dot"
											data-active={
												(editorState.timeline.camera3dPose === "end") === end
											}
											style={end ? { right: "5px" } : { left: "5px" }}
											onMouseDown={stopControlDrag}
											onClick={(e) => {
												e.stopPropagation();
												projectActions.selectCamera3DPose(index(), end);
											}}
										/>
									)}
								</For>
							</Show>
						</SegmentRoot>
					);
				}}
			</For>
			<Show
				when={editorState.timeline.camera3dAutoPreview}
				fallback={
					<Show
						when={
							!useTrackContext().trackState.draggingSegment &&
							(dragRange() ?? (hasCamera3DSegments() ? newShotDetails() : null))
						}
					>
						{(range) => <AddShotGhost labelled range={range()} />}
					</Show>
				}
			>
				{(count) => (
					<For each={camera3DAutoScenePreview(count())}>
						{(range) => <AddShotGhost range={range} />}
					</For>
				)}
			</Show>
		</TrackRoot>
	);
}

/**
 * The dashed preview of the shot a click would create, with its left edge on
 * the cursor. It is not interactive itself: the lane underneath owns the click
 * and the drag, so the ghost can never swallow either.
 */
function AddShotGhost(props: {
	range: { start: number; end: number };
	labelled?: boolean;
}) {
	const translateX = useSegmentTranslateX(() => props.range);
	const width = useSegmentWidth(() => props.range);
	const seconds = () => props.range.end - props.range.start;

	return (
		<div
			class="cap-add-shot-ghost"
			style={{
				transform: `translateX(${translateX()}px)`,
				width: `${width()}px`,
			}}
		>
			<Show when={props.labelled}>
				<span class="truncate">
					{width() >= GHOST_FULL_LABEL_PX
						? localize("添加镜头 · 平滑移动 · {seconds} 秒", {
								seconds: seconds().toFixed(1),
							})
						: width() >= GHOST_LABEL_PX
							? localize("添加镜头")
							: "+"}
				</span>
			</Show>
		</div>
	);
}
