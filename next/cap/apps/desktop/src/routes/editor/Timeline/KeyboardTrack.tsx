import { createMemo, For } from "solid-js";
import { t as localize } from "~/utils/i18n";
import type { KeyboardTrackSegment } from "~/utils/tauri";

import { useEditorContext } from "../context";
import { useTimelineContext } from "./context";
import { createTimelineMouseDrag } from "./mouse-drag";
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
	const { secsPerPixel } = useTimelineContext();

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

	function createMouseDownDrag<T>(
		segmentIndex: () => number,
		setup: () => T,
		update: (
			e: MouseEvent,
			value: T,
			initialMouseX: number,
		) => Partial<Pick<KeyboardTrackSegment, "start" | "end">>,
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
				const initial = setup();
				let moved = false;
				let resumeHistory: (() => void) | undefined;
				props.onDragStateChanged({ type: "movePending" });

				function finish(event?: MouseEvent) {
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
					const changes = update(event, initial, downEvent.clientX);
					if (
						(changes.start ?? segment.start) === segment.start &&
						(changes.end ?? segment.end) === segment.end
					)
						return;
					resumeHistory ??= projectHistory.pause();
					setProject("timeline", "keyboardSegments", segmentIndex(), changes);
				}

				return {
					diagnostics: {
						kind: "keyboard",
						snapshot: () => ({
							initialScale: scale,
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
						segment.id === id &&
						keyboardSegments().includes(segment),
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
								onMouseDown={createMouseDownDrag(
									index,
									() => {
										const bounds = neighborBounds(index());
										const start = segment.start;
										const minValue = bounds.prevEnd;
										const maxValue = Math.max(
											minValue,
											Math.min(
												segment.end - minDuration(),
												bounds.nextStart - minDuration(),
											),
										);
										return { start, minValue, maxValue };
									},
									(e, value, initialMouseX) => {
										const delta = (e.clientX - initialMouseX) * secsPerPixel();
										const next = Math.max(
											value.minValue,
											Math.min(value.maxValue, value.start + delta),
										);
										return { start: next };
									},
								)}
							/>
							<SegmentContent
								class="flex items-center cursor-grab overflow-hidden"
								onMouseDown={createMouseDownDrag(
									index,
									() => {
										const original = { ...segment };
										const bounds = neighborBounds(index());
										const minDelta = bounds.prevEnd - original.start;
										const maxDelta = bounds.nextStart - original.end;
										return { original, minDelta, maxDelta };
									},
									(e, value, initialMouseX) => {
										const delta = (e.clientX - initialMouseX) * secsPerPixel();
										const lowerBound = Math.min(value.minDelta, value.maxDelta);
										const upperBound = Math.max(value.minDelta, value.maxDelta);
										const clampedDelta = Math.min(
											upperBound,
											Math.max(lowerBound, delta),
										);
										return {
											start: value.original.start + clampedDelta,
											end: value.original.end + clampedDelta,
										};
									},
								)}
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
								onMouseDown={createMouseDownDrag(
									index,
									() => {
										const bounds = neighborBounds(index());
										const end = segment.end;
										const minValue = segment.start + minDuration();
										const maxValue = Math.max(minValue, bounds.nextStart);
										return { end, minValue, maxValue };
									},
									(e, value, initialMouseX) => {
										const delta = (e.clientX - initialMouseX) * secsPerPixel();
										const next = Math.max(
											value.minValue,
											Math.min(value.maxValue, value.end + delta),
										);
										return { end: next };
									},
								)}
							/>
						</SegmentRoot>
					);
				}}
			</For>
		</TrackRoot>
	);
}
