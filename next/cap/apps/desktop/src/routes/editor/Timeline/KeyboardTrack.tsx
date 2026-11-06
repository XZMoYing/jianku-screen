import { createMemo, For } from "solid-js";
import { t as localize } from "~/utils/i18n";

import { useEditorContext } from "../context";
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
} from "./Track";

export type KeyboardSegmentDragState =
	| { type: "idle" }
	| { type: "movePending" }
	| { type: "moving" };

const MIN_SEGMENT_SECS = 0.3;
const MIN_SEGMENT_PIXELS = 30;

export function KeyboardTrack(props: {
	onDragStateChanged: (v: KeyboardSegmentDragState) => void;
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
	} = useEditorContext();
	const { secsPerPixel, timelineBounds, snapping } = useTimelineContext();

	const minDuration = () =>
		Math.max(MIN_SEGMENT_SECS, secsPerPixel() * MIN_SEGMENT_PIXELS);

	const allKeyboardSegments = () => project.timeline?.keyboardSegments ?? [];
	const keyboardSegments = createMemo(() =>
		allKeyboardSegments().filter((s) => s.start < totalDuration()),
	);
	const selectedKeyboardIndices = createMemo(() => {
		const selection = editorState.timeline.selection;
		if (!selection || selection.type !== "keyboard") return null;
		return new Set(selection.indices);
	});

	const neighborBounds = (index: number) => {
		const segments = keyboardSegments()
			.slice()
			.sort((a, b) => a.start - b.start);
		const position = segments.indexOf(allKeyboardSegments()[index]);
		return {
			prevEnd: segments[position - 1]?.end ?? 0,
			nextStart: segments[position + 1]?.start ?? totalDuration(),
		};
	};

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
				const segment = allKeyboardSegments()[segmentIndex()];
				if (!segment) return null;
				const id = segment.id;
				const scale = secsPerPixel();
				const duration = totalDuration();
				const drag = createTimelineRangeDrag(
					snapping,
					segment,
					edge,
					neighborBounds(segmentIndex()),
					minDuration(),
					editorState.playbackTime,
				);
				let expected = drag.original;
				const ownsRange = () =>
					segment.id === id &&
					keyboardSegments().includes(segment) &&
					sameTimelineRange(segment, expected);
				let moved = false;
				let resumeHistory: (() => void) | undefined;
				props.onDragStateChanged({ type: "movePending" });

				function finish(
					event?: MouseEvent,
					reason?: TimelineMouseDragEndReason,
				) {
					drag.clear();
					if (
						reason === "cancel" &&
						ownsRange() &&
						!sameTimelineRange(segment, drag.original)
					)
						setProject(
							"timeline",
							"keyboardSegments",
							segmentIndex(),
							drag.original,
						);
					resumeHistory?.();
					if (!moved && event) {
						event.stopPropagation();
						const index = segmentIndex();
						const selection = editorState.timeline.selection;
						if (
							(event.ctrlKey || event.metaKey) &&
							selection?.type === "keyboard"
						) {
							const base = selection.indices;
							const indices = base.includes(index)
								? base.filter((value) => value !== index)
								: [...base, index];
							setEditorState(
								"timeline",
								"selection",
								indices.length ? { type: "keyboard", indices } : null,
							);
						} else {
							setEditorState("timeline", "selection", {
								type: "keyboard",
								indices: [index],
							});
						}
						props.handleUpdatePlayhead(event);
					}
					props.onDragStateChanged({ type: "idle" });
				}

				function handleUpdate(event: MouseEvent) {
					if (!moved) {
						if (Math.abs(event.clientX - downEvent.clientX) <= 2) return;
						moved = true;
						props.onDragStateChanged({ type: "moving" });
					}
					const range = drag.edit(
						(event.clientX - downEvent.clientX) * scale,
						scale,
						event.altKey,
					);
					if (sameTimelineRange(segment, range)) return;
					resumeHistory ??= projectHistory.pause();
					expected = range;
					setProject("timeline", "keyboardSegments", segmentIndex(), range);
				}

				return {
					diagnostics: {
						kind: "keyboard",
						snapshot: () => ({
							initialScale: scale,
							viewportWidth: String(timelineBounds.width),
							viewportZoom: String(editorState.timeline.transform.zoom),
							currentScale: secsPerPixel(),
							initialDuration: duration,
							currentDuration: totalDuration(),
							sameId: segment.id === id,
							sameSourceObject: allKeyboardSegments().includes(segment),
							visible: keyboardSegments().includes(segment),
							interactMode: editorState.timeline.interactMode,
							start: segment.start,
							end: segment.end,
							documentFocused: document.hasFocus(),
						}),
					},
					isValid: () =>
						editorState.timeline.interactMode === "seek" &&
						secsPerPixel() === scale &&
						totalDuration() === duration &&
						ownsRange(),
					update: handleUpdate,
					finish,
				};
			});
		};
	}

	return (
		<TrackRoot
			onMouseEnter={() =>
				setEditorState("timeline", "hoveredTrack", "keyboard")
			}
			onMouseLeave={() => setEditorState("timeline", "hoveredTrack", null)}
		>
			<For
				each={keyboardSegments()}
				fallback={
					<div class="cap-empty-lane pointer-events-none">
						<span>{localize("No keyboard events")}</span>
						<span class="cap-empty-lane-action">
							{localize("· Record keyboard presses or generate from recording")}
						</span>
					</div>
				}
			>
				{(segment) => {
					const index = () => allKeyboardSegments().indexOf(segment);
					const isSelected = createMemo(() => {
						const indices = selectedKeyboardIndices();
						if (!indices) return false;
						return indices.has(index());
					});

					const segmentWidth = () =>
						Math.min(segment.end, totalDuration()) - segment.start;

					// Truncation degrades gracefully, so the same row serves both the
					// full and compact tiers; it just clips against a smaller box.
					const keysLabel = () => (
						<div class="cap-seg-labels font-mono">
							<span class="cap-seg-label truncate max-w-full">
								{segment.displayText || "⌨"}
							</span>
						</div>
					);

					return (
						<SegmentRoot
							menuTarget={{ type: "keyboard", index: index() }}
							data-keyboard-segment
							data-index={index()}
							segColor="var(--track-keyboard)"
							class="group"
							selected={isSelected()}
							title={segment.displayText || localize("按键")}
							segment={{
								start: segment.start,
								end: Math.min(segment.end, totalDuration()),
							}}
							onMouseDown={(e) => {
								if (e.button !== 0) return;
								e.stopPropagation();
								if (editorState.timeline.interactMode === "split") {
									const rect = e.currentTarget.getBoundingClientRect();
									const fraction = (e.clientX - rect.left) / rect.width;
									const splitTime = fraction * segmentWidth();
									projectActions.splitKeyboardSegment(index(), splitTime);
								}
							}}
						>
							<SegmentHandle
								position="start"
								onMouseDown={createMouseDownDrag(index, "start")}
							/>
							<SegmentContent
								class="flex items-center cursor-grab overflow-hidden"
								onMouseDown={createMouseDownDrag(index, "move")}
							>
								<SegmentLabel
									compactAt={24}
									full={keysLabel}
									compact={keysLabel}
									glyph={() => <span class="cap-seg-label font-mono">⌨</span>}
								/>
							</SegmentContent>
							<SegmentHandle
								position="end"
								onMouseDown={createMouseDownDrag(index, "end")}
							/>
						</SegmentRoot>
					);
				}}
			</For>
		</TrackRoot>
	);
}
