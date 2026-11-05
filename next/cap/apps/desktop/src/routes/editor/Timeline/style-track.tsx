import { batch, For, Show } from "solid-js";
import { t as localize } from "~/utils/i18n";
import type { ImageSegment, StyleSegment } from "~/utils/tauri";
import { useEditorContext } from "../context";
import { editOverlayInterval } from "../style";
import { useTimelineContext } from "./context";
import { createTimelineMouseDrag } from "./mouse-drag";
import { nearestTimelineSnap, SPLIT_SNAP_PX } from "./split-snapping";
import {
	SegmentContent,
	SegmentHandle,
	SegmentLabel,
	SegmentRoot,
	TrackRoot,
} from "./Track";

export type OverlayDragState = { type: "idle" | "movePending" | "moving" };
export type OverlayTrackProps = {
	laneIndex: number;
	onDragStateChanged(value: OverlayDragState): void;
	handleUpdatePlayhead(event: MouseEvent): void;
};

export function StyleTrack(props: OverlayTrackProps) {
	return <OverlayTrack {...props} type="style" />;
}

export function OverlayTrack(
	props: OverlayTrackProps & { type: "style" | "image" },
) {
	const {
		project,
		setProject,
		editorState,
		setEditorState,
		projectActions,
		projectHistory,
		totalDuration,
	} = useEditorContext();
	const { secsPerPixel, timelineBounds, snapping } = useTimelineContext();
	const allSegments = (): (StyleSegment | ImageSegment)[] =>
		(props.type === "style"
			? project.timeline?.styleSegments
			: project.timeline?.imageSegments) ?? [];
	const segments = () =>
		allSegments().filter((segment) => segment.track === props.laneIndex);
	const selected = (index: number) =>
		editorState.timeline.selection?.type === props.type &&
		editorState.timeline.selection.indices.includes(index);
	const startGesture = createTimelineMouseDrag();

	const timeAt = (event: MouseEvent) =>
		Math.max(
			0,
			Math.min(
				totalDuration(),
				editorState.timeline.transform.position +
					(event.clientX - (timelineBounds.left ?? 0)) * secsPerPixel(),
			),
		);
	const add = (time: number) => {
		if (props.type === "style")
			projectActions.addStyleSegment(props.laneIndex, time);
		else void projectActions.importImageSegment(props.laneIndex, time);
	};
	function select(index: number, event: MouseEvent) {
		const previous = editorState.timeline.selection;
		let indices = [index];
		if (previous?.type === props.type) {
			if (event.metaKey || event.ctrlKey)
				indices = previous.indices.includes(index)
					? previous.indices.filter((value) => value !== index)
					: [...previous.indices, index];
			else if (event.shiftKey) {
				const anchor = previous.indices[previous.indices.length - 1] ?? index;
				indices = segments()
					.filter(
						(item) =>
							allSegments().indexOf(item) >= Math.min(anchor, index) &&
							allSegments().indexOf(item) <= Math.max(anchor, index),
					)
					.map((item) => allSegments().indexOf(item));
			}
		}
		setEditorState(
			"timeline",
			"selection",
			indices.length ? { type: props.type, indices } : null,
		);
		const segment = allSegments()[index];
		if (segment) {
			setEditorState("previewTime", null);
			setEditorState(
				"playbackTime",
				Math.min(
					Math.max(editorState.playbackTime, segment.start),
					segment.end - 0.001,
				),
			);
		}
	}
	function drag(
		event: MouseEvent,
		segment: StyleSegment | ImageSegment,
		edge: "start" | "move" | "end",
	) {
		event.stopPropagation();
		if (event.button !== 0) return;
		startGesture(() => null);
		const index = allSegments().indexOf(segment);
		if (index < 0) return;
		if (editorState.timeline.interactMode === "split") {
			projectActions.splitOverlaySegment(props.type, index, timeAt(event));
			return;
		}
		if (editorState.timeline.interactMode !== "seek") return;
		event.preventDefault();
		const snapPlayhead = editorState.playbackTime;
		select(index, event);
		if (event.metaKey || event.ctrlKey || event.shiftKey) return;
		startGesture(() => {
			const initial = { start: segment.start, end: segment.end };
			const initialPlaybackTime = editorState.playbackTime;
			const targets = snapping
				? [snapPlayhead, ...snapping.targets(segment)]
				: [];
			const edges = edge === "move" ? (["start", "end"] as const) : [edge];
			const lane = props.laneIndex;
			const type = props.type;
			const scale = secsPerPixel();
			const span = totalDuration();
			const neighbours = segments()
				.filter((item) => item !== segment)
				.map((item) => ({ item, start: item.start, end: item.end }));
			const previousEnd = neighbours.reduce(
				(end, value) =>
					value.end <= initial.start ? Math.max(end, value.end) : end,
				0,
			);
			const nextStart = neighbours.reduce(
				(start, value) =>
					value.start >= initial.end ? Math.min(start, value.start) : start,
				span,
			);
			let expected = initial;
			let moved = false;
			let resume: (() => void) | undefined;
			const sameContext = () =>
				props.type === type &&
				props.laneIndex === lane &&
				segment.track === lane &&
				secsPerPixel() === scale &&
				totalDuration() === span;
			const sameRange = () =>
				allSegments().includes(segment) &&
				segment.start === expected.start &&
				segment.end === expected.end;
			const write = (interval: { start: number; end: number }) => {
				const currentIndex = allSegments().indexOf(segment);
				if (currentIndex < 0) return;
				expected = interval;
				if (type === "style")
					setProject("timeline", "styleSegments", currentIndex, interval);
				else setProject("timeline", "imageSegments", currentIndex, interval);
			};
			const sameNeighbours = () => {
				const current = new Set(segments());
				return (
					current.size === neighbours.length + 1 &&
					neighbours.every(
						(value) =>
							current.has(value.item) &&
							value.item.start === value.start &&
							value.item.end === value.end,
					)
				);
			};
			props.onDragStateChanged({ type: "movePending" });
			return {
				isValid: () =>
					sameContext() &&
					sameRange() &&
					sameNeighbours() &&
					editorState.timeline.interactMode === "seek",
				update: (next: MouseEvent) => {
					if (!moved && Math.abs(next.clientX - event.clientX) < 2) return;
					moved = true;
					props.onDragStateChanged({ type: "moving" });
					const delta = (next.clientX - event.clientX) * scale;
					const edit = (value: number) =>
						editOverlayInterval(initial, value, edge, previousEnd, nextStart);
					const snap =
						snapping?.enabled() && !next.altKey
							? nearestTimelineSnap(
									edges.map((side) => initial[side] + delta),
									targets,
									SPLIT_SNAP_PX * scale,
									(shift, side, target) =>
										Math.abs(edit(delta + shift)[edges[side]] - target) < 1e-7,
								)
							: null;
					snapping?.setGuide(snap?.time ?? null);
					const interval = edit(delta + (snap?.delta ?? 0));
					if (
						interval.start !== segment.start ||
						interval.end !== segment.end
					) {
						resume ??= projectHistory.pause();
						batch(() => {
							write(interval);
							setEditorState("previewTime", null);
							setEditorState(
								"playbackTime",
								edge === "end" ? interval.end - 0.001 : interval.start,
							);
						});
					}
				},
				finish: (_next, reason) => {
					snapping?.setGuide(null);
					if (
						reason === "cancel" &&
						resume &&
						sameContext() &&
						sameRange() &&
						sameNeighbours() &&
						editorState.timeline.interactMode === "seek"
					) {
						batch(() => {
							write(initial);
							setEditorState("playbackTime", initialPlaybackTime);
						});
					}
					resume?.();
					props.onDragStateChanged({ type: "idle" });
				},
			};
		});
	}

	return (
		<TrackRoot
			onDblClick={(event) => {
				if (!(event.target as HTMLElement).closest("[data-overlay-segment]")) {
					event.stopPropagation();
					startGesture(() => null);
					add(timeAt(event));
				}
			}}
		>
			<Show when={segments().length === 0}>
				<button
					type="button"
					disabled={props.type === "image" && editorState.importingImage}
					class="cap-empty-lane pointer-events-auto"
					onMouseDown={(event) => {
						event.stopPropagation();
						startGesture(() => null);
					}}
					onClick={(event) => {
						event.stopPropagation();
						add(editorState.playbackTime);
					}}
				>
					<Show
						when={props.type === "image"}
						fallback={
							<>
								<span>
									{localize(
										"Change background, camera and cursor for part of your video",
									)}
								</span>
								<span class="cap-empty-lane-action">
									{localize("· Add style")}
								</span>
							</>
						}
					>
						<span>{localize("Place images and logos on your video")}</span>
						<span class="cap-empty-lane-action">
							{editorState.importingImage
								? localize("· Importing image…")
								: localize("· Add image")}
						</span>
					</Show>
				</button>
			</Show>
			<For each={segments()}>
				{(segment) => {
					const index = () => allSegments().indexOf(segment);
					return (
						<SegmentRoot
							menuTarget={{ type: props.type, index: index() }}
							segment={segment}
							data-overlay-segment
							data-index={index()}
							segColor={`var(--track-${props.type})`}
							class="group"
							selected={selected(index())}
							muted={!segment.enabled}
							title={`${segment.name} · ${(segment.end - segment.start).toFixed(2)}s`}
						>
							<SegmentHandle
								position="start"
								onMouseDown={(event) => drag(event, segment, "start")}
							/>
							<SegmentContent
								class="cursor-grab overflow-hidden"
								onMouseDown={(event) => drag(event, segment, "move")}
							>
								<SegmentLabel
									full={() => (
										<div class="cap-seg-labels">
											<span class="cap-seg-label truncate">{segment.name}</span>
											<span class="cap-seg-sublabel">
												{`${(segment.end - segment.start).toFixed(1)}s`}
											</span>
										</div>
									)}
									compact={() => (
										<span class="cap-seg-label truncate">{segment.name}</span>
									)}
								/>
							</SegmentContent>
							<SegmentHandle
								position="end"
								onMouseDown={(event) => drag(event, segment, "end")}
							/>
						</SegmentRoot>
					);
				}}
			</For>
		</TrackRoot>
	);
}
