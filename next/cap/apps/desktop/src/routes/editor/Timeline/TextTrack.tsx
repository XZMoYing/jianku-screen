import { batch, createMemo, createSignal, For, Show } from "solid-js";
import { produce } from "solid-js/store";
import { cssFontFamily } from "~/utils/fonts";
import { t as localize } from "~/utils/i18n";
import { useEditorContext } from "../context";
import { autoTextColorAt, defaultTextSegment, type TextSegment } from "../text";
import { getSegmentTrack, sortTrackSegments } from "../timelineTracks";
import { useTimelineContext } from "./context";
import {
	createTimelineMouseDrag,
	type TimelineMouseDragEndReason,
} from "./mouse-drag";
import {
	createTimelineRangeDrag,
	sameTimelineRange,
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

export type TextSegmentDragState =
	| { type: "idle" }
	| { type: "movePending" }
	| { type: "moving" };

const MIN_SEGMENT_SECS = 1;
const MIN_SEGMENT_PIXELS = 80;

export function TextTrack(props: {
	laneIndex: number;
	onDragStateChanged: (v: TextSegmentDragState) => void;
	handleUpdatePlayhead: (e: MouseEvent) => void;
}) {
	const {
		project,
		setProject,
		editorState,
		setEditorState,
		totalDuration,
		projectHistory,
		projectActions,
		canvasControls,
	} = useEditorContext();
	const { secsPerPixel, timelineBounds, snapping } = useTimelineContext();
	const [draggingSegment, setDraggingSegment] = createSignal(false);
	const [hoveringTrack, setHoveringTrack] = createSignal(false);
	const setPreviewTime = useSetPreviewTime();

	const minDuration = () =>
		Math.max(MIN_SEGMENT_SECS, secsPerPixel() * MIN_SEGMENT_PIXELS);

	const textSegments = () => project.timeline?.textSegments ?? [];
	const laneSegments = createMemo(() =>
		textSegments().filter(
			(segment) => getSegmentTrack(segment) === props.laneIndex,
		),
	);
	const laneSegmentPositionByIndex = createMemo(() => {
		const positions = new Map<number, number>();
		const segments = laneSegments();
		for (let i = 0; i < segments.length; i++) {
			positions.set(textSegments().indexOf(segments[i]), i);
		}
		return positions;
	});
	const sortedLaneSegments = createMemo(() => {
		const sorted = laneSegments().slice();
		sorted.sort((a, b) => a.start - b.start);
		return sorted;
	});
	const selectedTextIndices = createMemo(() => {
		const selection = editorState.timeline.selection;
		if (!selection || selection.type !== "text") return null;
		return new Set(selection.indices);
	});

	const neighborBounds = (index: number) => {
		const segments = laneSegments();
		const laneIndex = laneSegmentPositionByIndex().get(index) ?? -1;
		return {
			prevEnd: segments[laneIndex - 1]?.end ?? 0,
			nextStart: segments[laneIndex + 1]?.start ?? totalDuration(),
		};
	};

	const findPlacement = (time: number, length: number) => {
		const gaps: Array<{ start: number; end: number }> = [];
		const sorted = sortedLaneSegments();

		let cursor = 0;
		for (const segment of sorted) {
			if (segment.start - cursor >= length) {
				gaps.push({ start: cursor, end: segment.start });
			}
			cursor = Math.max(cursor, segment.end);
		}

		if (totalDuration() - cursor >= length) {
			gaps.push({ start: cursor, end: totalDuration() });
		}

		if (gaps.length === 0) return null;

		const maxStart = Math.max(totalDuration() - length, 0);
		const desiredStart = Math.min(Math.max(time - length / 2, 0), maxStart);

		const containingGap =
			gaps.find(
				(gap) => desiredStart >= gap.start && desiredStart + length <= gap.end,
			) ??
			gaps.find((gap) => gap.start >= desiredStart) ??
			gaps[gaps.length - 1];

		const start = Math.min(
			Math.max(desiredStart, containingGap.start),
			containingGap.end - length,
		);

		return { start, end: start + length };
	};

	const addSegmentAt = (time: number) => {
		const length = Math.min(minDuration(), totalDuration());
		if (length <= 0) return false;

		const placement = findPlacement(time, length);
		if (!placement) return false;

		setProject(
			"timeline",
			"textSegments",
			produce((segments) => {
				segments ??= [];
				segments.push({
					...defaultTextSegment(placement.start, placement.end),
					color: autoTextColorAt(canvasControls()),
					track: props.laneIndex,
				});
				sortTrackSegments(segments);
			}),
		);

		// Select the new segment right away so its canvas box and config
		// sidebar appear without an extra click.
		const newIndex = (project.timeline?.textSegments ?? []).findIndex(
			(segment) =>
				segment.start === placement.start &&
				getSegmentTrack(segment) === props.laneIndex,
		);
		if (newIndex !== -1) {
			setEditorState("timeline", "selection", {
				type: "text",
				indices: [newIndex],
			});
		}

		return true;
	};

	const newSegmentDetails = createMemo(() => {
		if (!hoveringTrack() || editorState.previewTime === null) return;

		const previewTime = editorState.previewTime;

		if (
			laneSegments().some(
				(segment) => previewTime > segment.start && previewTime < segment.end,
			)
		)
			return;

		return findPlacement(previewTime, Math.min(minDuration(), totalDuration()));
	});

	const handleBackgroundMouseDown = (e: MouseEvent) => {
		if (e.button !== 0) return;
		if ((e.target as HTMLElement).closest("[data-text-segment]")) return;
		const timelineTime =
			editorState.previewTime ??
			editorState.playbackTime ??
			secsPerPixel() * (e.clientX - (timelineBounds.left ?? 0));
		if (!addSegmentAt(timelineTime)) return;
		// This click created and selected a segment — stop it reaching the
		// timeline container, whose mouseup handler would immediately clear
		// the selection again. Take over its playhead update instead.
		e.stopPropagation();
		setEditorState("timeline", "audioPicker", null);
		props.handleUpdatePlayhead(e);
	};

	function writeSegment(segment: TextSegment, changes: Partial<TextSegment>) {
		const index = textSegments().indexOf(segment);
		if (index < 0) return;
		const selection = editorState.timeline.selection;
		const selected =
			selection?.type === "text"
				? selection.indices.map((value) => textSegments()[value])
				: undefined;
		batch(() => {
			setProject("timeline", "textSegments", index, changes);
			setProject(
				"timeline",
				"textSegments",
				produce((items) => {
					sortTrackSegments(items);
				}),
			);
			if (selected && selection?.type === "text") {
				const indices = selected
					.map((item) => textSegments().indexOf(item))
					.filter((value) => value >= 0);
				if (
					indices.some(
						(value, position) => value !== selection.indices[position],
					) ||
					indices.length !== selection.indices.length
				)
					setEditorState(
						"timeline",
						"selection",
						indices.length ? { type: "text", indices } : null,
					);
			}
		});
	}

	const startDrag = createTimelineMouseDrag();

	function createMouseDownDrag(
		segmentIndex: () => number,
		edge: TimelineRangeEdge,
	) {
		return (downEvent: MouseEvent) => {
			if (
				downEvent.button !== 0 ||
				editorState.timeline.interactMode !== "seek"
			)
				return;
			downEvent.stopPropagation();
			startDrag(() => {
				const segment = textSegments()[segmentIndex()];
				if (!segment) return null;
				const lane = props.laneIndex;
				const drag = createTimelineRangeDrag(
					snapping,
					segment,
					edge,
					neighborBounds(segmentIndex()),
					minDuration(),
					editorState.playbackTime,
				);
				let expected = drag.original;
				const previewBefore = editorState.previewTime;
				let lastPreview: number | undefined;
				const ownsRange = () =>
					props.laneIndex === lane &&
					getSegmentTrack(segment) === lane &&
					textSegments().includes(segment) &&
					sameTimelineRange(segment, expected);
				let moved = false;
				let initialMouseX: number | null = null;

				const resumeHistory = projectHistory.pause();
				setDraggingSegment(true);
				props.onDragStateChanged({ type: "movePending" });

				function finish(e?: MouseEvent, reason?: TimelineMouseDragEndReason) {
					drag.clear();
					if (reason === "cancel" && ownsRange()) {
						if (!sameTimelineRange(segment, drag.original))
							writeSegment(segment, drag.original);
						if (
							lastPreview !== undefined &&
							editorState.previewTime === lastPreview
						)
							setEditorState("previewTime", previewBefore);
					}
					resumeHistory();
					if (!moved && e) {
						e.stopPropagation();
						const currentSelection = editorState.timeline.selection;
						const index = segmentIndex();
						const isMultiSelect = e.ctrlKey || e.metaKey;
						const isRangeSelect = e.shiftKey;

						if (isRangeSelect && currentSelection?.type === "text") {
							const existingIndices = currentSelection.indices;
							const lastIndex = existingIndices[existingIndices.length - 1];
							const start = Math.min(lastIndex, index);
							const end = Math.max(lastIndex, index);
							const rangeIndices: number[] = [];
							for (let idx = start; idx <= end; idx++) rangeIndices.push(idx);
							setEditorState("timeline", "selection", {
								type: "text",
								indices: rangeIndices,
							});
						} else if (isMultiSelect) {
							if (currentSelection?.type === "text") {
								const base = currentSelection.indices;
								const exists = base.includes(index);
								const next = exists
									? base.filter((i) => i !== index)
									: [...base, index];
								setEditorState(
									"timeline",
									"selection",
									next.length > 0
										? {
												type: "text",
												indices: next,
											}
										: null,
								);
							} else {
								setEditorState("timeline", "selection", {
									type: "text",
									indices: [index],
								});
							}
						} else {
							setEditorState("timeline", "selection", {
								type: "text",
								indices: [index],
							});
						}
						props.handleUpdatePlayhead(e);
					}
					props.onDragStateChanged({ type: "idle" });
					setDraggingSegment(false);
				}

				function handleUpdate(event: MouseEvent) {
					if (Math.abs(event.clientX - downEvent.clientX) > 2) {
						if (!moved) {
							moved = true;
							initialMouseX = event.clientX;
							props.onDragStateChanged({ type: "moving" });
						}
					}

					if (initialMouseX === null) return;
					const scale = secsPerPixel();
					const range = drag.edit(
						(event.clientX - initialMouseX) * scale,
						scale,
						event.altKey,
					);
					if (!sameTimelineRange(segment, range)) {
						expected = range;
						writeSegment(segment, range);
					}
					if (edge !== "move") {
						lastPreview = range[edge];
						setPreviewTime(lastPreview);
					}
				}

				return {
					isValid: () =>
						editorState.timeline.interactMode === "seek" && ownsRange(),
					update: handleUpdate,
					finish,
				};
			});
		};
	}

	return (
		<TrackRoot
			onMouseEnter={() => {
				setHoveringTrack(true);
				setEditorState("timeline", "hoveredTrack", "text");
			}}
			onMouseLeave={() => {
				setHoveringTrack(false);
				setEditorState("timeline", "hoveredTrack", null);
			}}
			onMouseDown={handleBackgroundMouseDown}
		>
			<For
				each={laneSegments()}
				fallback={
					<Show
						when={!newSegmentDetails()}
						fallback={<div class="w-full rounded-lg bg-transparent" />}
					>
						<div class="cap-empty-lane pointer-events-none">
							<span>{localize("Set a label over your video")}</span>
							<span class="cap-empty-lane-action">
								{localize("· Add text")}
							</span>
						</div>
					</Show>
				}
			>
				{(segment) => {
					const index = () => textSegments().indexOf(segment);
					const isSelected = createMemo(() => {
						const indices = selectedTextIndices();
						if (!indices) return false;
						return indices.has(index());
					});

					const segmentWidth = () => segment.end - segment.start;

					const textContentRow = () => (
						<div class="cap-seg-labels max-w-full">
							<span
								class="size-2 shrink-0 rounded-full ring-1 ring-ed-line-strong"
								style={{
									"background-color": segment.color ?? "#ffffff",
								}}
							/>
							<span
								class="cap-seg-label truncate max-w-full"
								style={{
									"font-family": cssFontFamily(
										segment.fontFamily ?? "sans-serif",
									),
									"font-style": segment.italic ? "italic" : "normal",
									"font-weight": segment.fontWeight ?? 700,
								}}
							>
								{segment.content || localize("文本")}
							</span>
						</div>
					);

					const textTitle = () => {
						const base = `${localize("文本")} · ${segment.content || localize("文本")}`;
						return segment.layout === "fullscreen"
							? `${base} · Fullscreen: pauses the video while shown`
							: base;
					};

					return (
						<SegmentRoot
							menuTarget={{ type: "text", index: index() }}
							data-text-segment
							data-index={index()}
							segColor="var(--track-text)"
							class="group"
							selected={isSelected()}
							muted={!segment.enabled}
							title={textTitle()}
							segment={segment}
							onMouseDown={(e) => {
								e.stopPropagation();
								if (editorState.timeline.interactMode === "split") {
									const rect = e.currentTarget.getBoundingClientRect();
									const fraction = (e.clientX - rect.left) / rect.width;
									const splitTime = fraction * segmentWidth();
									projectActions.splitTextSegment(index(), splitTime);
								}
							}}
						>
							<SegmentHandle
								position="start"
								onMouseDown={createMouseDownDrag(() => index(), "start")}
							/>
							<SegmentContent
								class="flex items-center cursor-grab overflow-hidden"
								onMouseDown={createMouseDownDrag(() => index(), "move")}
							>
								<SegmentLabel
									full={() => (
										<div class="cap-seg-labels">
											<span class="cap-seg-label flex gap-1 items-center">
												{localize("Text")}
												<Show when={segment.layout === "fullscreen"}>
													<IconLucidePause class="size-2.5" />
												</Show>
											</span>
											{textContentRow()}
										</div>
									)}
									compact={() => textContentRow()}
									glyph={
										segment.layout === "fullscreen"
											? () => <IconLucidePause class="size-2.5 cap-seg-label" />
											: undefined
									}
								/>
							</SegmentContent>
							<SegmentHandle
								position="end"
								onMouseDown={createMouseDownDrag(() => index(), "end")}
							/>
						</SegmentRoot>
					);
				}}
			</For>
			<Show when={!draggingSegment() && newSegmentDetails()}>
				{(details) => (
					<SegmentRoot
						class="pointer-events-none z-10"
						ghost
						segColor="var(--track-text)"
						segment={details()}
					>
						<SegmentContent class="justify-center">
							<p class="cap-seg-label">+</p>
						</SegmentContent>
					</SegmentRoot>
				)}
			</Show>
		</TrackRoot>
	);
}
