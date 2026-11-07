import { createMemo, For } from "solid-js";
import { t as localize } from "~/utils/i18n";
import { applyEditedCaptionTimingToMaster } from "../captions";
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

export type CaptionSegmentDragState =
	| { type: "idle" }
	| { type: "movePending" }
	| { type: "moving" };

const MIN_SEGMENT_SECS = 0.5;
const MIN_SEGMENT_PIXELS = 40;

export function CaptionsTrack(props: {
	onDragStateChanged: (v: CaptionSegmentDragState) => void;
	handleUpdatePlayhead: (e: MouseEvent) => void;
	onGenerate: () => void | Promise<void>;
	isGenerating: boolean;
}) {
	const {
		project,
		setProject,
		editorState,
		setEditorState,
		totalDuration,
		projectHistory,
		projectActions,
		editorInstance,
	} = useEditorContext();
	const { secsPerPixel, snapping } = useTimelineContext();

	const minDuration = () =>
		Math.max(MIN_SEGMENT_SECS, secsPerPixel() * MIN_SEGMENT_PIXELS);

	const allCaptionSegments = () => project.timeline?.captionSegments ?? [];
	const captionSegments = createMemo(() =>
		allCaptionSegments().filter((segment) => segment.start < totalDuration()),
	);
	const selectedCaptionIndices = createMemo(() => {
		const selection = editorState.timeline.selection;
		if (!selection || selection.type !== "caption") return null;
		return new Set(selection.indices);
	});

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
				const segment = allCaptionSegments()[segmentIndex()];
				if (!segment) return null;
				const ordered = captionSegments()
					.slice()
					.sort((a, b) => a.start - b.start);
				const position = ordered.indexOf(segment);
				const drag = createTimelineRangeDrag(
					snapping,
					segment,
					edge,
					{
						prevEnd: ordered[position - 1]?.end ?? 0,
						nextStart: ordered[position + 1]?.start ?? totalDuration(),
					},
					minDuration(),
					editorState.playbackTime,
				);
				let expected = drag.original;
				let initialMouseX: number | null = null;
				let resumeHistory: (() => void) | undefined;
				const ownsRange = () =>
					allCaptionSegments().includes(segment) &&
					sameTimelineRange(segment, expected);
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
							"captionSegments",
							segmentIndex(),
							drag.original,
						);
					if (
						(reason === "release" || reason === "history") &&
						ownsRange() &&
						!sameTimelineRange(segment, drag.original)
					) {
						const timeline = project.timeline;
						const sourceSegments = project.captions?.segments;
						if (timeline && sourceSegments) {
							const updated = applyEditedCaptionTimingToMaster(
								sourceSegments,
								segment.id,
								segment.start,
								segment.end,
								timeline.segments,
								editorInstance.recordings.segments,
								timeline.transitions ?? [],
								timeline.textSegments ?? [],
								timeline.mainTrackGaps,
							);
							if (updated) setProject("captions", "segments", updated);
						}
					}
					resumeHistory?.();
					if (initialMouseX === null && event) {
						event.stopPropagation();
						const index = segmentIndex();
						const selection = editorState.timeline.selection;
						const indices =
							(event.ctrlKey || event.metaKey) && selection?.type === "caption"
								? selection.indices.includes(index)
									? selection.indices.filter((value) => value !== index)
									: [...selection.indices, index]
								: [index];
						setEditorState(
							"timeline",
							"selection",
							indices.length ? { type: "caption", indices } : null,
						);
						props.handleUpdatePlayhead(event);
					}
					props.onDragStateChanged({ type: "idle" });
				}

				return {
					isValid: () =>
						editorState.timeline.interactMode === "seek" && ownsRange(),
					update(event) {
						if (initialMouseX === null) {
							if (Math.abs(event.clientX - downEvent.clientX) <= 2) return;
							initialMouseX = event.clientX;
							props.onDragStateChanged({ type: "moving" });
						}
						const scale = secsPerPixel();
						const range = drag.edit(
							(event.clientX - initialMouseX) * scale,
							scale,
							event.altKey,
						);
						if (sameTimelineRange(segment, range)) return;
						resumeHistory ??= projectHistory.pause();
						expected = range;
						setProject("timeline", "captionSegments", segmentIndex(), range);
					},
					finish,
				};
			});
		};
	}

	return (
		<TrackRoot
			onMouseEnter={() => setEditorState("timeline", "hoveredTrack", "caption")}
			onMouseLeave={() => setEditorState("timeline", "hoveredTrack", null)}
		>
			<For
				each={captionSegments()}
				fallback={
					<div class="cap-empty-lane">
						<span>{localize("No captions")}</span>
						<button
							type="button"
							class="cap-empty-lane-action outline-hidden"
							disabled={props.isGenerating}
							onMouseDown={(e) => e.stopPropagation()}
							onClick={(e) => {
								e.stopPropagation();
								void props.onGenerate();
							}}
						>
							·{" "}
							{props.isGenerating
								? localize("Generating...")
								: localize("生成字幕")}
						</button>
					</div>
				}
			>
				{(segment) => {
					const index = () => allCaptionSegments().indexOf(segment);
					const isSelected = createMemo(() => {
						const indices = selectedCaptionIndices();
						if (!indices) return false;
						return indices.has(index());
					});

					const segmentWidth = () =>
						Math.min(segment.end, totalDuration()) - segment.start;

					// Truncation degrades gracefully, so the same row serves both the
					// full and compact tiers; it just clips against a smaller box.
					const captionLabel = () => (
						<div class="cap-seg-labels">
							<span class="cap-seg-label truncate max-w-full">
								{segment.text || localize("字幕")}
							</span>
						</div>
					);

					return (
						<SegmentRoot
							menuTarget={{ type: "caption", index: index() }}
							data-caption-segment
							data-index={index()}
							segColor="var(--track-caption)"
							class="group"
							selected={isSelected()}
							title={segment.text || localize("字幕")}
							segment={{
								start: segment.start,
								end: Math.min(segment.end, totalDuration()),
							}}
							onMouseDown={(e) => {
								e.stopPropagation();
								if (editorState.timeline.interactMode === "split") {
									const rect = e.currentTarget.getBoundingClientRect();
									const fraction = (e.clientX - rect.left) / rect.width;
									const splitTime = fraction * segmentWidth();
									projectActions.splitCaptionSegment(index(), splitTime);
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
									full={captionLabel}
									compact={captionLabel}
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
