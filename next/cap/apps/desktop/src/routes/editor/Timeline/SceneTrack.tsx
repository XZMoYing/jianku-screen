import { createEventListener } from "@solid-primitives/event-listener";
import {
	batch,
	createEffect,
	createMemo,
	createRoot,
	createSignal,
	For,
	Show,
} from "solid-js";
import { produce } from "solid-js/store";
import { t as localize } from "~/utils/i18n";

import { useEditorContext } from "../context";
import { useTimelineContext, useTrackContext } from "./context";
import {
	createTimelineMouseDrag,
	type TimelineMouseDragEndCause,
	type TimelineMouseDragEndReason,
} from "./mouse-drag";
import {
	createOrderedTimelineRangeDrag,
	sameTimelineRange,
	type TimelineRange,
	type TimelineRangeEdge,
} from "./range-snapping";
import {
	SegmentContent,
	SegmentHandle,
	SegmentLabel,
	SegmentRoot,
	TrackRoot,
	useSetPreviewTime,
} from "./Track";

export type SceneSegmentDragState =
	| { type: "idle" }
	| { type: "movePending" }
	| { type: "moving" };

const MIN_SCENE_SEGMENT_PIXEL_WIDTH = 80;

export function SceneTrack(props: {
	onDragStateChanged: (v: SceneSegmentDragState) => void;
	handleUpdatePlayhead: (e: MouseEvent) => void;
}) {
	const {
		project,
		setProject,
		projectHistory,
		setEditorState,
		editorState,
		projectActions,
		totalDuration,
	} = useEditorContext();

	const { duration, secsPerPixel, snapping } = useTimelineContext();
	const startDrag = createTimelineMouseDrag();
	const setPreviewTime = useSetPreviewTime();
	const selectedSceneIndices = createMemo(() => {
		const selection = editorState.timeline.selection;
		if (!selection || selection.type !== "scene") return null;
		return new Set(selection.indices);
	});

	const [hoveringSegment, setHoveringSegment] = createSignal(false);
	const [hoveredTime, setHoveredTime] = createSignal<number>();
	const [maxAvailableDuration, setMaxAvailableDuration] =
		createSignal<number>(3);

	// When we delete a segment that's being hovered, the onMouseLeave never fires
	// because the element gets removed from the DOM. This leaves hoveringSegment stuck
	// as true, which blocks the onMouseMove from setting hoveredTime, preventing
	// users from creating new segments. This effect ensures we reset the hover state
	// when all segments are deleted.
	createEffect(() => {
		const segments = project.timeline?.sceneSegments;
		if (!segments || segments.length === 0) {
			setHoveringSegment(false);
		}
	});

	const getSceneIcon = (mode: string | undefined) => {
		switch (mode) {
			case "cameraOnly":
				return <IconLucideVideo class="size-3.5" />;
			case "hideCamera":
				return <IconLucideEyeOff class="size-3.5" />;
			case "splitScreen":
				return <IconLucideColumns2 class="size-3.5" />;
			case "floating":
				return <IconLucidePanelRight class="size-3.5" />;
			default:
				return <IconLucideMonitor class="size-3.5" />;
		}
	};

	const getSceneLabel = (mode: string | undefined) => {
		switch (mode) {
			case "cameraOnly":
				return "Camera Only";
			case "hideCamera":
				return "Hide Camera";
			case "splitScreen":
				return "Split Screen";
			case "floating":
				return "Floating";
			default:
				return "Default";
		}
	};

	return (
		<TrackRoot
			onMouseEnter={() => setEditorState("timeline", "hoveredTrack", "scene")}
			onMouseMove={(e) => {
				if (hoveringSegment()) {
					setHoveredTime(undefined);
					return;
				}

				const bounds = e.currentTarget.getBoundingClientRect();

				let time =
					(e.clientX - bounds.left) * secsPerPixel() +
					editorState.timeline.transform.position;

				const segments = project.timeline?.sceneSegments || [];
				const nextSegmentIndex = segments.findIndex((s) => time < s.start);

				let maxDuration = 3; // Default duration

				if (nextSegmentIndex !== -1) {
					const nextSegment = segments[nextSegmentIndex];
					const prevSegmentIndex = nextSegmentIndex - 1;

					if (prevSegmentIndex >= 0) {
						const prevSegment = segments[prevSegmentIndex];
						const gapStart = prevSegment.end;
						const gapEnd = nextSegment.start;
						const availableSpace = gapEnd - gapStart;

						if (availableSpace < 0.5) {
							setHoveredTime(undefined);
							return;
						}

						if (time < gapStart) {
							time = gapStart;
						}

						maxDuration = Math.min(3, gapEnd - time);
					} else {
						// No previous segment, only next segment
						maxDuration = Math.min(3, nextSegment.start - time);
					}

					if (nextSegment.start - time < 0.5) {
						setHoveredTime(undefined);
						return;
					}
				} else if (segments.length > 0) {
					const lastSegment = segments[segments.length - 1];
					if (time < lastSegment.end) {
						time = lastSegment.end;
					}
					maxDuration = Math.min(3, duration() - time);
				} else {
					maxDuration = Math.min(3, duration() - time);
				}

				if (maxDuration < 0.5) {
					setHoveredTime(undefined);
					return;
				}

				setMaxAvailableDuration(maxDuration);
				setHoveredTime(Math.min(time, duration() - maxDuration));
			}}
			onMouseLeave={() => {
				setHoveredTime();
				setMaxAvailableDuration(3);
				setEditorState("timeline", "hoveredTrack", null);
			}}
			onMouseDown={(e) => {
				createRoot((dispose) => {
					createEventListener(e.currentTarget, "mouseup", (e) => {
						dispose();

						const time = hoveredTime();
						const maxDuration = maxAvailableDuration();
						if (time === undefined) return;

						e.stopPropagation();
						batch(() => {
							setProject("timeline", "sceneSegments", (v) => v ?? []);
							setProject(
								"timeline",
								"sceneSegments",
								produce((sceneSegments) => {
									sceneSegments ??= [];

									let index = sceneSegments.length;

									for (let i = sceneSegments.length - 1; i >= 0; i--) {
										if (sceneSegments[i].start > time) {
											index = i;
											break;
										}
									}

									sceneSegments.splice(index, 0, {
										start: time,
										end: time + maxDuration,
										mode: "cameraOnly",
									});
								}),
							);
						});
					});
				});
			}}
		>
			<For
				each={project.timeline?.sceneSegments}
				fallback={
					<div class="cap-empty-lane pointer-events-none">
						<span>
							{localize("Switch layouts between your screen and camera")}
						</span>
						<span class="cap-empty-lane-action">{localize("· Add scene")}</span>
					</div>
				}
			>
				{(segment, i) => {
					const { setTrackState } = useTrackContext();

					const sceneSegments = () => project.timeline?.sceneSegments ?? [];

					// Double-clicking a handle expands the segment as far as it can go
					// in that direction (up to the neighbouring segment / timeline edge).
					const fillStart = () => {
						const segs = sceneSegments();
						let minValue = 0;
						for (let j = segs.length - 1; j >= 0; j--) {
							const s = segs[j];
							if (s && s.end <= segment.start) {
								minValue = s.end;
								break;
							}
						}
						batch(() => {
							setProject("timeline", "sceneSegments", i(), "start", minValue);
							setProject(
								"timeline",
								"sceneSegments",
								produce((s) => {
									s?.sort((a, b) => a.start - b.start);
								}),
							);
						});
						setPreviewTime(minValue);
					};

					const fillEnd = () => {
						const segs = sceneSegments();
						let maxValue = totalDuration();
						for (let j = 0; j < segs.length; j++) {
							const s = segs[j];
							if (s && s.start > segment.end) {
								maxValue = s.start;
								break;
							}
						}
						batch(() => {
							setProject("timeline", "sceneSegments", i(), "end", maxValue);
							setProject(
								"timeline",
								"sceneSegments",
								produce((s) => {
									s?.sort((a, b) => a.start - b.start);
								}),
							);
						});
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
							startDrag(() => {
								const scale = secsPerPixel();
								const drag = createOrderedTimelineRangeDrag(
									snapping,
									segment,
									edge,
									sceneSegments(),
									duration(),
									Math.max(1, scale * MIN_SCENE_SEGMENT_PIXEL_WIDTH),
									editorState.playbackTime,
									false,
								);
								let expected = drag.original;
								let initialMouseX: number | null = null;
								let moved = false;
								let resumeHistory: (() => void) | undefined;
								const previewBefore = editorState.previewTime;
								let lastPreview: number | undefined;
								const ownsRange = () =>
									sceneSegments().includes(segment) &&
									sameTimelineRange(segment, expected);
								setTrackState("draggingSegment", true);
								props.onDragStateChanged({ type: "movePending" });

								function writeRange(range: TimelineRange) {
									const index = sceneSegments().indexOf(segment);
									if (index < 0) return;
									batch(() => {
										setProject("timeline", "sceneSegments", index, range);
										if (edge !== "move")
											setProject(
												"timeline",
												"sceneSegments",
												produce((items) => {
													items?.sort((a, b) => a.start - b.start);
												}),
											);
									});
								}

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
										if (!sameTimelineRange(segment, drag.original))
											writeRange(drag.original);
										if (
											lastPreview !== undefined &&
											editorState.previewTime === lastPreview
										)
											setEditorState("previewTime", previewBefore);
									}
									resumeHistory?.();

									const currentIndex = i();
									if (e && !moved) {
										e.stopPropagation();
										const selection = editorState.timeline.selection;
										const selected =
											selection?.type === "scene" ? selection.indices : [];
										const isMac =
											navigator.platform.toUpperCase().indexOf("MAC") >= 0;
										let indices = [currentIndex];
										if (e.shiftKey && selected.length) {
											const anchor = selected[selected.length - 1];
											const first = Math.min(anchor, currentIndex);
											const last = Math.max(anchor, currentIndex);
											indices = Array.from(
												{ length: last - first + 1 },
												(_, index) => first + index,
											);
										} else if (isMac ? e.metaKey : e.ctrlKey) {
											indices = selected.includes(currentIndex)
												? selected.filter((index) => index !== currentIndex)
												: [...selected, currentIndex];
										}
										setEditorState(
											"timeline",
											"selection",
											indices.length ? { type: "scene", indices } : null,
										);
										props.handleUpdatePlayhead(e);
									} else if (reason === "release") {
										setEditorState("timeline", "selection", {
											type: "scene",
											indices: [currentIndex],
										});
									}
									props.onDragStateChanged({ type: "idle" });
									setTrackState("draggingSegment", false);
								}

								return {
									isValid: () =>
										editorState.timeline.interactMode === "seek" && ownsRange(),
									update(event) {
										if (initialMouseX === null) {
											if (Math.abs(event.clientX - downEvent.clientX) <= 2)
												return;
											moved = true;
											initialMouseX = event.clientX;
											props.onDragStateChanged({ type: "moving" });
										}
										const scale = secsPerPixel();
										const range = drag.edit(
											(event.clientX - initialMouseX) * scale,
											scale,
											event.altKey,
										);
										if (!sameTimelineRange(segment, range)) {
											resumeHistory ??= projectHistory.pause();
											expected = range;
											writeRange(range);
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
						const indices = selectedSceneIndices();
						if (!indices) return false;
						return indices.has(i());
					});

					return (
						<SegmentRoot
							menuTarget={{ type: "scene", index: i() }}
							segColor="var(--track-scene)"
							class="group"
							selected={isSelected()}
							title={`Scene · ${getSceneLabel(segment.mode)}`}
							segment={segment}
							onMouseEnter={() => {
								setHoveringSegment(true);
							}}
							onMouseLeave={() => {
								setHoveringSegment(false);
							}}
							onMouseDown={(e) => {
								e.stopPropagation();

								if (editorState.timeline.interactMode === "split") {
									const rect = e.currentTarget.getBoundingClientRect();
									const fraction = (e.clientX - rect.left) / rect.width;

									const splitTime = fraction * (segment.end - segment.start);

									projectActions.splitSceneSegment(i(), splitTime);
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
								<SegmentLabel
									full={() => (
										<div class="cap-seg-labels animate-in fade-in">
											<span class="cap-seg-label">{localize("Scene")}</span>
											<span class="cap-seg-sublabel truncate">
												{getSceneLabel(segment.mode)}
											</span>
										</div>
									)}
									compact={() => (
										<div class="cap-seg-labels">
											<span class="cap-seg-label truncate">
												{getSceneLabel(segment.mode)}
											</span>
										</div>
									)}
									glyph={() => (
										<div class="cap-seg-label flex justify-center items-center">
											{getSceneIcon(segment.mode)}
										</div>
									)}
								/>
							</SegmentContent>
							<SegmentHandle
								position="end"
								onDblClick={(e) => {
									e.stopPropagation();
									fillEnd();
								}}
								onMouseDown={createMouseDownDrag("end")}
							/>
						</SegmentRoot>
					);
				}}
			</For>
			<Show
				when={!useTrackContext().trackState.draggingSegment && hoveredTime()}
			>
				{(time) => (
					<SegmentRoot
						class="pointer-events-none"
						ghost
						segColor="var(--track-scene)"
						segment={{
							start: time(),
							end: time() + maxAvailableDuration(),
						}}
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
