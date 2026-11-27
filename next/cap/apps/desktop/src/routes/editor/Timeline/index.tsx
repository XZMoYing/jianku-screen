import { createElementBounds } from "@solid-primitives/bounds";
import {
	createEventListener,
	createEventListenerMap,
} from "@solid-primitives/event-listener";
import { makePersisted } from "@solid-primitives/storage";
import { platform } from "@tauri-apps/plugin-os";
import { cx } from "cva";
import {
	batch,
	createEffect,
	createMemo,
	createRoot,
	createSignal,
	For,
	Index,
	type JSX,
	Match,
	on,
	onCleanup,
	onMount,
	Show,
	Switch,
} from "solid-js";
import { produce } from "solid-js/store";
import toast from "solid-toast";
import type { EditorCommand } from "~/utils/editor-keymap";
import { t as localize } from "~/utils/i18n";
import IconLucideAlignHorizontalDistributeCenter from "~icons/lucide/align-horizontal-distribute-center";
import IconLucideArrowLeftToLine from "~icons/lucide/arrow-left-to-line";
import IconLucideArrowRightToLine from "~icons/lucide/arrow-right-to-line";
import IconLucideMagnet from "~icons/lucide/magnet";
import IconLucideMousePointer2 from "~icons/lucide/mouse-pointer-2";
import IconLucidePalette from "~icons/lucide/palette";
import IconLucidePencil from "~icons/lucide/pencil";
import IconLucideScissors from "~icons/lucide/scissors";
import IconLucideSplit from "~icons/lucide/scissors-line-dashed";
import { newClipInstance } from "../clip-identity";
import { stylesRevealCamera } from "../style";
import { ImageTrack } from "./image-track";
import { ShapeTrack } from "./shape-track";
import { type OverlayDragState, StyleTrack } from "./style-track";

import "./styles.css";

import { defaultCaptionSettings } from "~/store/captions";
import { defaultKeyboardSettings } from "~/store/keyboard";
import { commands } from "~/utils/tauri";
import type { AudioTrackSegment } from "../audio";
import {
	applyCaptionResultToProject,
	getCaptionGenerationErrorMessage,
	getSelectedTranscriptionSettings,
	transcribeEditorCaptions,
} from "../captions";
import {
	clipDuration,
	clipEndOnOutput,
	clipTimelineOffsets,
} from "../clip-transitions";
import {
	type EditorProjectConfiguration,
	FPS,
	type TimelineTrackType,
	useEditorContext,
} from "../context";
import {
	createEditorContextMenu,
	isContextMenuKey,
} from "../editor-context-menu";
import type { MaskSegment } from "../masks";
import type { TextSegment } from "../text";
import { timelinePreviewFrame } from "../timeline-duration";
import { effectiveToOutput, holdWindows } from "../timeline-holds";
import {
	getOverlayTrackRows,
	getSegmentTrack,
	getTrackRowsWithCount,
	getUsedTrackCount,
	isOverlayTrackKind,
	moveOverlayTrack,
	moveTrackLane,
	type OverlayTrack,
	removeOverlayTrack,
	sameOverlayTrack,
	trackInsertionIndex,
} from "../timelineTracks";
import { EditorButton, Slider } from "../ui";
import { formatTime } from "../utils";
import { type AudioSegmentDragState, AudioTrack } from "./AudioTrack";
import { BookmarkTrack } from "./BookmarkTrack";
import { type CaptionSegmentDragState, CaptionsTrack } from "./CaptionsTrack";
import { ClipTrack } from "./ClipTrack";
import {
	type SegmentMenuTarget,
	TimelineContextProvider,
	useTimelineContext,
} from "./context";
import { createTimelineHoverPreview } from "./hover-preview";
import { type KeyboardSegmentDragState, KeyboardTrack } from "./KeyboardTrack";
import { type MaskSegmentDragState, MaskTrack } from "./MaskTrack";
import { Minimap } from "./Minimap";
import { PlaybackFollow } from "./playback-follow";
import { type SceneSegmentDragState, SceneTrack } from "./SceneTrack";
import { createTimelineSegmentMenu } from "./segment-menu";
import { overlayBoundaryTargets } from "./split-snapping";
import { type TextSegmentDragState, TextTrack } from "./TextTrack";
import { type ThreeDSegmentDragState, ThreeDTrack } from "./ThreeDTrack";
import { TrackIcon, TrackManager } from "./TrackManager";
import { createTimelineScale } from "./timeline-scale";
import { type ZoomSegmentDragState, ZoomTrack } from "./ZoomTrack";

// The timeline renders inside the editor's timeline card, which supplies the
// 10px 12px 12px padding; these constants describe the geometry inside it.
// 104 is the narrowest gutter that fits the "Add track" pill without
// truncating its label on the widest system UI font (Segoe UI on Windows).
const TRACK_GUTTER = 104;
const EDIT_COMMANDS_HEIGHT = 28;
const TRACK_ICON_WIDTH = TRACK_GUTTER;
const TRACK_GUTTER_INSET = 4;
const TIMELINE_HEADER_HEIGHT = 26;
const TIMELINE_HEADER_GAP = 4;
const PLAYHEAD_TOP_OFFSET = TIMELINE_HEADER_HEIGHT - 12;
const TRACK_ROW_HEIGHT = 44;
const TRACK_ROW_GAP = 6;
const TRACK_HEIGHT = `${TRACK_ROW_HEIGHT}px`;
const START_SNAP_PX = 10;
const RULER_SCRUB_OVERHANG_PX = 4;

const trackIcons: Record<TimelineTrackType, () => JSX.Element> = {
	style: () => <IconLucidePalette class="size-3" />,
	image: () => <IconCapImage class="size-3" />,
	shape: () => <IconLucidePencil class="size-3" />,
	clip: () => <IconLucideClapperboard class="size-3" />,
	caption: () => <IconCapCaptions class="size-3" />,
	keyboard: () => <IconLucideKeyboard class="size-3" />,
	text: () => <IconLucideType class="size-3" />,
	mask: () => <IconLucideBoxSelect class="size-3" />,
	zoom: () => <IconLucideSearch class="size-3" />,
	scene: () => <IconLucideVideo class="size-3" />,
	audio: () => <IconLucideMusic class="size-3" />,
	"3d": () => <IconLucideRotate3d class="size-3" />,
};

type TrackDefinition = {
	type: TimelineTrackType;
	label: string;
	icon: () => JSX.Element;
	locked: boolean;
};

const trackDefinitions: TrackDefinition[] = [
	{ type: "style", label: "Style", icon: trackIcons.style, locked: false },
	{ type: "image", label: "Image", icon: trackIcons.image, locked: false },
	{ type: "shape", label: "Shape", icon: trackIcons.shape, locked: false },
	{
		type: "clip",
		label: "Clip",
		icon: trackIcons.clip,
		locked: true,
	},
	{
		type: "caption",
		label: "Captions",
		icon: trackIcons.caption,
		locked: false,
	},
	{
		type: "keyboard",
		label: "Keyboard",
		icon: trackIcons.keyboard,
		locked: false,
	},
	{
		type: "text",
		label: "Text",
		icon: trackIcons.text,
		locked: false,
	},
	{
		type: "mask",
		label: "Mask",
		icon: trackIcons.mask,
		locked: false,
	},
	{
		type: "audio",
		label: "Audio",
		icon: trackIcons.audio,
		locked: false,
	},
	{
		type: "zoom",
		label: "Zoom",
		icon: trackIcons.zoom,
		locked: true,
	},
	{
		type: "scene",
		label: "Scene",
		icon: trackIcons.scene,
		locked: false,
	},
	{
		type: "3d",
		label: "3D",
		icon: trackIcons["3d"],
		locked: false,
	},
];

function deleteTrackLane<T extends { track?: number }>(
	segments: T[],
	laneIndex: number,
) {
	return segments
		.filter((segment) => (segment.track ?? 0) !== laneIndex)
		.map<T>((segment) => {
			const track = segment.track ?? 0;
			if (track <= laneIndex) return segment;
			return { ...segment, track: track - 1 };
		});
}

import { useEditorShortcuts } from "../useEditorShortcuts";

export function Timeline(props: {
	inactive?: boolean;
	onViewportOverflowChange?: (value: {
		overflow: number;
		visibleTrackCount: number;
	}) => void;
	onContentHeightChange?: (height: number) => void;
}) {
	const {
		project,
		setProject,
		editorInstance,
		projectHistory,
		setEditorState,
		totalDuration,
		zoomOutLimit,
		editorState,
		projectActions,
		mainTrackMagnetic,
		toggleMainTrackMagnetism,
		meta,
		previewResolutionBase,
		playbackIntent,
		requestHandoffPlayback,
		keymap,
		timelineCommands,
		recordingBookmarks,
	} = useEditorContext();

	const duration = () => editorInstance.recordingDuration;
	const transform = () => editorState.timeline.transform;

	const [timelineContainerRef, setTimelineContainerRef] =
		createSignal<HTMLDivElement>();
	const blankMenu = createEditorContextMenu();
	const segmentMenu = createTimelineSegmentMenu(
		(time) => void seekPlayheadTo(time),
	);
	const [trackPickerOpen, setTrackPickerOpen] = createSignal(false);
	const [snappingEnabled, setSnappingEnabled] = makePersisted(
		createSignal(true),
		{
			name: "editorTimelineSnappingEnabled",
		},
	);
	const [snapGuide, setSnapGuide] = createSignal<number | null>(null);
	const toggleSnapping = () => {
		setSnappingEnabled((enabled) => !enabled);
		if (!snappingEnabled()) {
			setSnapGuide(null);
			setEditorState("timeline", "splitPreview", null);
		}
	};
	const snapping = {
		enabled: snappingEnabled,
		targets: (exclude?: object, stableClipPrefix?: number) => {
			const timeline = project.timeline;
			const clips = timeline?.segments ?? [];
			const offsets = clipTimelineOffsets(
				clips,
				timeline?.transitions ?? [],
				timeline?.mainTrackGaps,
			);
			const holds = holdWindows(timeline?.textSegments);
			return [
				...clips.flatMap((clip, index) =>
					clip === exclude ||
					(stableClipPrefix !== undefined && index >= stableClipPrefix)
						? []
						: [
								effectiveToOutput(holds, offsets[index]),
								clipEndOnOutput(
									holds,
									clips,
									index,
									offsets[index] + clipDuration(clip),
									timeline?.mainTrackGaps,
								),
							],
				),
				...(recordingBookmarks.items() ?? []).flatMap(
					(bookmark) => bookmark.positions,
				),
				...overlayBoundaryTargets(timeline, exclude),
			];
		},
		setGuide: setSnapGuide,
	};

	createEventListener(
		timelineContainerRef,
		"mousedown",
		(event) => {
			if (event.button !== 0 || (event.ctrlKey && platform() === "macos"))
				event.stopPropagation();
		},
		{ capture: true },
	);

	const [timelineScrollRef, setTimelineScrollRef] =
		createSignal<HTMLDivElement>();
	const [timelineRef, setTimelineRef] = createSignal<HTMLDivElement>();
	const timelineBounds = createElementBounds(timelineRef);

	const secsPerPixel = createTimelineScale(
		() => transform().zoom / (timelineBounds.width ?? 1),
	);
	const playbackFollow = new PlaybackFollow();
	const playbackDuration = createMemo(totalDuration);
	let followRafId: number | null = null;
	let timelinePointerDown = false;

	createEventListener(
		window,
		"mousedown",
		(event) => {
			if (event.button === 0 && event.target instanceof Node) {
				timelinePointerDown =
					timelineContainerRef()?.contains(event.target) ?? false;
			}
		},
		{ capture: true },
	);
	createEventListenerMap(window, {
		mouseup: () => {
			timelinePointerDown = false;
		},
		blur: () => {
			timelinePointerDown = false;
		},
	});

	function cancelPlaybackFollow() {
		if (followRafId !== null) cancelAnimationFrame(followRafId);
		followRafId = null;
		playbackFollow.reset();
	}

	createEffect(
		on(
			[() => editorState.playing, () => editorState.playbackTime],
			([playing]) => {
				if (!playing) {
					cancelPlaybackFollow();
					return;
				}
				if (followRafId !== null) return;
				followRafId = requestAnimationFrame(() => {
					followRafId = null;
					if (!editorState.playing || !timelineBounds.width) return;
					const viewport = transform();
					const position = playbackFollow.update(
						viewport,
						editorState.playbackTime,
						playbackDuration(),
						performance.now(),
						timelinePointerDown,
					);
					if (position !== viewport.position) {
						setEditorState("timeline", "transform", "position", position);
					}
				});
			},
		),
	);
	onCleanup(cancelPlaybackFollow);

	const trackState = () => editorState.timeline.tracks;
	const sceneAvailable = () =>
		meta().hasCamera &&
		(!project.camera.hide ||
			stylesRevealCamera(project.timeline?.styleSegments ?? []) ||
			!!project.timeline?.sceneSegments?.length);
	const captionTrackVisible = () => trackState().caption;
	const keyboardTrackVisible = () => trackState().keyboard;
	const threeDTrackVisible = () => trackState()["3d"];
	const trackOptions = createMemo(() =>
		trackDefinitions.map((definition) => ({
			...definition,
			active:
				definition.type === "style" ||
				definition.type === "image" ||
				definition.type === "shape"
					? trackState()[definition.type] > 0
					: definition.type === "caption"
						? trackState().caption
						: definition.type === "keyboard"
							? trackState().keyboard
							: definition.type === "scene"
								? trackState().scene
								: definition.type === "3d"
									? trackState()["3d"]
									: definition.type === "mask"
										? trackState().mask > 0
										: definition.type === "text"
											? trackState().text > 0
											: definition.type === "audio"
												? trackState().audio > 0
												: true,
			available: definition.type === "scene" ? sceneAvailable() : true,
			supportsMultiple:
				definition.type === "style" ||
				definition.type === "image" ||
				definition.type === "shape" ||
				definition.type === "mask" ||
				definition.type === "text" ||
				definition.type === "audio",
			count:
				definition.type === "style" ||
				definition.type === "image" ||
				definition.type === "shape"
					? trackState()[definition.type]
					: definition.type === "mask"
						? trackState().mask
						: definition.type === "text"
							? trackState().text
							: definition.type === "audio"
								? trackState().audio
								: 0,
		})),
	);
	const sceneTrackVisible = () => trackState().scene && sceneAvailable();
	const styleTrackRows = createMemo(() =>
		getTrackRowsWithCount(
			project.timeline?.styleSegments ?? [],
			trackState().style,
		).reverse(),
	);
	const overlayTrackRows = createMemo<OverlayTrack[]>((previous) =>
		getOverlayTrackRows(project, trackState()).map(
			(row) => previous?.find((item) => sameOverlayTrack(item, row)) ?? row,
		),
	);
	const audioTrackRows = createMemo(() =>
		getTrackRowsWithCount(
			project.timeline?.audioSegments ?? [],
			trackState().audio,
		).reverse(),
	);
	const visibleTrackCount = createMemo(
		() =>
			2 +
			styleTrackRows().length +
			overlayTrackRows().length +
			(captionTrackVisible() ? 1 : 0) +
			(keyboardTrackVisible() ? 1 : 0) +
			audioTrackRows().length +
			(threeDTrackVisible() ? 1 : 0) +
			(sceneTrackVisible() ? 1 : 0),
	);

	const contentHeight = createMemo(() => {
		const rows = Math.max(visibleTrackCount(), 1);
		return (
			EDIT_COMMANDS_HEIGHT +
			TIMELINE_HEADER_GAP +
			TIMELINE_HEADER_HEIGHT +
			TIMELINE_HEADER_GAP +
			rows * TRACK_ROW_HEIGHT +
			(rows - 1) * TRACK_ROW_GAP
		);
	});

	createEffect(() => {
		props.onContentHeightChange?.(contentHeight());
	});

	createEffect(() => {
		const visibleTracks = visibleTrackCount();
		const scrollContainer = timelineScrollRef();
		if (!scrollContainer) return;

		const frame = requestAnimationFrame(() => {
			const currentScrollContainer = timelineScrollRef();
			if (!currentScrollContainer) return;
			props.onViewportOverflowChange?.({
				visibleTrackCount: visibleTracks,
				overflow: Math.ceil(
					Math.max(
						currentScrollContainer.scrollHeight -
							currentScrollContainer.clientHeight,
						0,
					),
				),
			});
		});

		onCleanup(() => cancelAnimationFrame(frame));
	});

	function handleToggleTrack(type: TimelineTrackType, next: boolean) {
		if (type === "caption") {
			batch(() => {
				if (!project.captions) {
					setProject("captions", {
						segments: [],
						settings: { ...defaultCaptionSettings, enabled: next },
					});
				} else {
					setProject("captions", "settings", "enabled", next);
				}
				setEditorState("timeline", "tracks", "caption", next);
				if (!next && editorState.timeline.selection?.type === "caption") {
					setEditorState("timeline", "selection", null);
				}
			});
			return;
		}

		if (type === "keyboard") {
			batch(() => {
				if (!project.keyboard) {
					setProject("keyboard", {
						settings: { ...defaultKeyboardSettings, enabled: next },
					});
				} else {
					setProject("keyboard", "settings", "enabled", next);
				}
				setEditorState("timeline", "tracks", "keyboard", next);
				if (!next && editorState.timeline.selection?.type === "keyboard") {
					setEditorState("timeline", "selection", null);
				}
			});
			return;
		}

		if (type === "scene") {
			setEditorState("timeline", "tracks", "scene", next);
			return;
		}

		if (type === "3d") {
			// Turning the track on just shows the lane: the lane itself offers the
			// auto scene and the first shot.
			batch(() => {
				setEditorState("timeline", "tracks", "3d", next);
				if (!next && editorState.timeline.selection?.type === "3d") {
					setEditorState("timeline", "selection", null);
				}
			});
			return;
		}

		if (type === "text") {
			setEditorState(
				"timeline",
				"tracks",
				"text",
				next
					? Math.max(getUsedTrackCount(project.timeline?.textSegments ?? []), 1)
					: 0,
			);
			if (!next && editorState.timeline.selection?.type === "text") {
				setEditorState("timeline", "selection", null);
			}
			return;
		}

		if (type === "mask") {
			setEditorState(
				"timeline",
				"tracks",
				"mask",
				next
					? Math.max(getUsedTrackCount(project.timeline?.maskSegments ?? []), 1)
					: 0,
			);
			if (!next && editorState.timeline.selection?.type === "mask") {
				setEditorState("timeline", "selection", null);
			}
		}
	}

	function handleAddTrack(type: TimelineTrackType) {
		timelineCommands.addTrackContent(type, Math.max(1, secsPerPixel() * 80));
	}

	function handleDeleteTrackLane(
		type: "text" | "mask" | "audio" | "style" | "image" | "shape",
		laneIndex: number,
	) {
		if (type === "style" || type === "image" || type === "shape") {
			const resumeHistory = projectHistory.pause();
			const segments =
				(type === "style"
					? project.timeline?.styleSegments
					: type === "image"
						? project.timeline?.imageSegments
						: project.timeline?.shapeSegments) ?? [];
			projectActions.deleteOverlaySegments(
				type,
				segments.flatMap((segment, index) =>
					segment.track === laneIndex ? [index] : [],
				),
			);
			setProject(
				produce((project) => {
					const remaining =
						type === "style"
							? project.timeline?.styleSegments
							: type === "image"
								? project.timeline?.imageSegments
								: project.timeline?.shapeSegments;
					for (const segment of remaining ?? [])
						if (segment.track > laneIndex) segment.track -= 1;
					if (type === "image" || type === "shape")
						project.overlayOrder = removeOverlayTrack(
							project.overlayOrder,
							type,
							laneIndex,
						);
				}),
			);
			setEditorState(
				"timeline",
				"tracks",
				type,
				Math.max(0, trackState()[type] - 1),
			);
			resumeHistory();
			return;
		}
		const resumeHistory = projectHistory.pause();
		const currentTrackCount = trackState()[type];
		const nextTextSegments =
			type === "text"
				? deleteTrackLane<TextSegment>(
						project.timeline?.textSegments ?? [],
						laneIndex,
					)
				: null;
		const nextMaskSegments =
			type === "mask"
				? deleteTrackLane<MaskSegment>(
						project.timeline?.maskSegments ?? [],
						laneIndex,
					)
				: null;
		const nextAudioSegments =
			type === "audio"
				? deleteTrackLane<AudioTrackSegment>(
						project.timeline?.audioSegments ?? [],
						laneIndex,
					)
				: null;
		const usedTrackCount =
			type === "text"
				? getUsedTrackCount(nextTextSegments ?? [])
				: type === "mask"
					? getUsedTrackCount(nextMaskSegments ?? [])
					: getUsedTrackCount(nextAudioSegments ?? []);
		const nextTrackCount = Math.max(usedTrackCount, currentTrackCount - 1, 0);

		batch(() => {
			if (editorState.timeline.selection?.type === type) {
				setEditorState("timeline", "selection", null);
			}

			setProject(
				produce((project) => {
					const timeline = project.timeline;
					if (!timeline) return;

					if (type === "text" && nextTextSegments) {
						timeline.textSegments = nextTextSegments;
					} else if (type === "mask" && nextMaskSegments) {
						timeline.maskSegments = nextMaskSegments;
					} else if (nextAudioSegments) {
						timeline.audioSegments = nextAudioSegments;
					}
					if (isOverlayTrackKind(type))
						project.overlayOrder = removeOverlayTrack(
							project.overlayOrder,
							type,
							laneIndex,
						);
				}),
			);
			setEditorState("timeline", "tracks", type, nextTrackCount);
		});

		resumeHistory();
	}

	function handleDeleteSingleTrack(type: "caption" | "keyboard") {
		const resumeHistory = projectHistory.pause();

		batch(() => {
			if (editorState.timeline.selection?.type === type) {
				setEditorState("timeline", "selection", null);
			}

			if (type === "caption") {
				setProject(
					produce((project) => {
						if (project.captions) {
							project.captions.segments = [];
							project.captions.settings = {
								...defaultCaptionSettings,
								...project.captions.settings,
								enabled: false,
							};
						}
						project.timeline ??= {
							segments: [
								newClipInstance({ start: 0, end: duration(), timescale: 1 }),
							],
							zoomSegments: [],
							sceneSegments: [],
							maskSegments: [],
							textSegments: [],
							styleSegments: [],
							imageSegments: [],
							shapeSegments: [],
							captionSegments: [],
							keyboardSegments: [],
							camera3dSegments: [],
							transitions: [],
						};
						project.timeline.captionSegments = [];
					}),
				);
				setEditorState("timeline", "tracks", "caption", false);
			} else {
				setProject(
					produce((project) => {
						if (project.keyboard) {
							project.keyboard.settings = {
								...defaultKeyboardSettings,
								...project.keyboard.settings,
								enabled: false,
							};
						}
						project.timeline ??= {
							segments: [
								newClipInstance({ start: 0, end: duration(), timescale: 1 }),
							],
							zoomSegments: [],
							sceneSegments: [],
							maskSegments: [],
							textSegments: [],
							styleSegments: [],
							imageSegments: [],
							shapeSegments: [],
							captionSegments: [],
							keyboardSegments: [],
							camera3dSegments: [],
							transitions: [],
						};
						project.timeline.keyboardSegments = [];
					}),
				);
				setEditorState("timeline", "tracks", "keyboard", false);
			}
		});

		resumeHistory();
	}

	// Zoom, Scene and 3D keep their row once shown, so deleting from them
	// clears every segment on the track instead of hiding the row itself.
	function handleClearTrackSegments(type: "zoom" | "scene" | "3d") {
		const resumeHistory = projectHistory.pause();

		batch(() => {
			if (editorState.timeline.selection?.type === type) {
				setEditorState("timeline", "selection", null);
			}

			setProject(
				produce((project) => {
					const timeline = project.timeline;
					if (!timeline) return;
					if (type === "zoom") timeline.zoomSegments = [];
					else if (type === "3d") timeline.camera3dSegments = [];
					else timeline.sceneSegments = [];
				}),
			);
		});

		resumeHistory();
	}

	onMount(() => {
		if (!project.timeline) {
			const resume = projectHistory.pause();
			setProject("timeline", {
				segments: [
					newClipInstance({
						timescale: 1,
						start: 0,
						end: duration(),
					}),
				],
				zoomSegments: [],
				sceneSegments: [],
				maskSegments: [],
				textSegments: [],
				styleSegments: [],
				imageSegments: [],
				shapeSegments: [],
				captionSegments: [],
				keyboardSegments: [],
				camera3dSegments: [],
				transitions: [],
			});
			resume();
		}

		const checkBounds = () => {
			if (timelineBounds.width && timelineBounds.width > 0) {
				const minSegmentPixels = 80;
				const secondsPerPixel = 1 / minSegmentPixels;
				const desiredZoom = timelineBounds.width * secondsPerPixel;

				if (transform().zoom > desiredZoom) {
					transform().updateZoom(desiredZoom, 0);
				}
			} else {
				setTimeout(checkBounds, 10);
			}
		};

		checkBounds();
	});

	if (
		!project.timeline?.zoomSegments ||
		project.timeline.zoomSegments.length < 1 ||
		!project.timeline?.maskSegments ||
		!project.timeline?.textSegments ||
		!project.timeline?.camera3dSegments
	) {
		setProject(
			produce((project) => {
				project.timeline ??= {
					segments: [
						newClipInstance({
							start: 0,
							end: duration(),
							timescale: 1,
						}),
					],
					zoomSegments: [],
					sceneSegments: [],
					maskSegments: [],
					textSegments: [],
					styleSegments: [],
					imageSegments: [],
					shapeSegments: [],
					captionSegments: [],
					keyboardSegments: [],
					camera3dSegments: [],
					transitions: [],
				};
				project.timeline.sceneSegments ??= [];
				project.timeline.captionSegments ??= [];
				project.timeline.keyboardSegments ??= [];
				project.timeline.maskSegments ??= [];
				project.timeline.textSegments ??= [];
				project.timeline.zoomSegments ??= [];
				project.timeline.camera3dSegments ??= [];
				project.timeline.styleSegments ??= [];
				project.timeline.imageSegments ??= [];
				project.timeline.shapeSegments ??= [];
			}),
		);
	}

	let styleSegmentDragState: OverlayDragState = { type: "idle" };
	let imageSegmentDragState: OverlayDragState = { type: "idle" };
	let shapeSegmentDragState: OverlayDragState = { type: "idle" };
	let zoomSegmentDragState = { type: "idle" } as ZoomSegmentDragState;
	let sceneSegmentDragState = { type: "idle" } as SceneSegmentDragState;
	let maskSegmentDragState = { type: "idle" } as MaskSegmentDragState;
	let textSegmentDragState = { type: "idle" } as TextSegmentDragState;
	let audioSegmentDragState = { type: "idle" } as AudioSegmentDragState;
	let captionSegmentDragState = { type: "idle" } as CaptionSegmentDragState;
	let keyboardSegmentDragState = { type: "idle" } as KeyboardSegmentDragState;
	let threeDSegmentDragState = { type: "idle" } as ThreeDSegmentDragState;

	let pendingZoomDelta = 0;
	let pendingZoomOrigin: number | null = null;
	let zoomRafId: number | null = null;

	let pendingScrollDelta = 0;
	let scrollRafId: number | null = null;

	function flushPendingZoom() {
		if (pendingZoomDelta === 0 || pendingZoomOrigin === null) {
			zoomRafId = null;
			return;
		}

		const newZoom = transform().zoom + pendingZoomDelta;
		transform().updateZoom(newZoom, pendingZoomOrigin);

		pendingZoomDelta = 0;
		pendingZoomOrigin = null;
		zoomRafId = null;
	}

	function flushPendingScroll() {
		if (pendingScrollDelta === 0) {
			scrollRafId = null;
			return;
		}

		const newPosition = transform().position + pendingScrollDelta;
		transform().setPosition(newPosition);

		pendingScrollDelta = 0;
		scrollRafId = null;
	}

	function scheduleZoomUpdate(delta: number, origin: number) {
		pendingZoomDelta += delta;
		pendingZoomOrigin = origin;

		if (zoomRafId === null) {
			zoomRafId = requestAnimationFrame(flushPendingZoom);
		}
	}

	function scheduleScrollUpdate(delta: number) {
		pendingScrollDelta += delta;

		if (scrollRafId === null) {
			scrollRafId = requestAnimationFrame(flushPendingScroll);
		}
	}

	function getTimelineContentMetrics() {
		const container = timelineContainerRef();
		if (!container) return null;

		const rect = container.getBoundingClientRect();

		return {
			left: rect.left + TRACK_GUTTER,
			width: Math.max(timelineBounds.width ?? rect.width - TRACK_GUTTER, 0),
		};
	}

	function timelineTimeFromClientX(clientX: number) {
		const metrics = getTimelineContentMetrics();
		if (!metrics) return null;
		const rawTime =
			secsPerPixel() * (clientX - metrics.left) + transform().position;
		// Snap to the very start when the cursor lands within a few pixels
		// of the timeline origin so hitting exactly 0:00 isn't a battle
		const snappedTime = rawTime / secsPerPixel() <= START_SNAP_PX ? 0 : rawTime;
		return Math.min(Math.max(0, snappedTime), totalDuration());
	}

	function showBlankMenu(event: MouseEvent | KeyboardEvent) {
		if (props.inactive || timelinePointerDown) return;
		const time =
			"clientX" in event &&
			(event.button !== 0 || event.clientX || event.clientY)
				? timelineTimeFromClientX(event.clientX)
				: editorState.playbackTime;
		const gap = time === null ? null : timelineCommands.mainTrackGapAt(time);
		blankMenu.show(event, localize("时间线菜单"), [
			{
				label: localize("将播放头移到此处"),
				disabled: time === null || time === editorState.playbackTime,
				run: () => {
					if (time === null) return;
					setEditorState("previewTime", null);
					void seekPlayheadTo(time);
				},
			},
			...(gap
				? [
						{
							label: localize("关闭当前空隙"),
							run: () => timelineCommands.closeMainTrackGap(gap),
						},
					]
				: []),
			{
				label: localize("Add track"),
				run: () => queueMicrotask(() => setTrackPickerOpen(true)),
			},
			{
				label: localize(
					mainTrackMagnetic()
						? "Turn off main track magnetism"
						: "Close gaps and turn on main track magnetism",
				),
				run: toggleMainTrackMagnetism,
			},
			{
				label: localize("显示整个时间线"),
				shortcut: keymap.label("fit"),
				run: timelineCommands.fit,
			},
			{
				label: localize("取消选择"),
				shortcut: keymap.label("deselect"),
				disabled:
					!editorState.timeline.selection &&
					editorState.timeline.audioPicker === null,
				run: timelineCommands.deselect,
			},
		]);
	}

	function showSegmentMenu(
		event: MouseEvent | KeyboardEvent,
		target: SegmentMenuTarget,
	) {
		if (props.inactive || (timelinePointerDown && !target.cancelGesture))
			return;
		const track = trackDefinitions.find(
			(definition) => definition.type === target.type,
		);
		segmentMenu.show(event, target, localize(track?.label ?? target.type));
	}

	async function seekPlayheadTo(newTime: number) {
		setEditorState("previewTime", null);
		const pending = requestHandoffPlayback(
			playbackIntent() && newTime < totalDuration(),
			newTime,
		);
		if (pending) {
			await pending;
			return;
		}
		// If playing, some backends require restart to seek reliably
		if (editorState.playing) {
			try {
				await commands.stopPlayback();

				const targetFrame = timelinePreviewFrame(newTime, totalDuration(), FPS);
				await commands.seekTo(targetFrame);

				if (newTime >= totalDuration()) setEditorState("playing", false);
				// If the user paused during these async ops, bail out without restarting
				if (!editorState.playing) {
					setEditorState("playbackTime", newTime);
					return;
				}

				await commands.startPlayback(FPS, previewResolutionBase());
				setEditorState("playing", true);
			} catch (err) {
				console.error("Failed to seek during playback:", err);
			}
		}

		setEditorState("playbackTime", Math.min(newTime, totalDuration()));
	}

	async function handleUpdatePlayhead(e: MouseEvent) {
		if (
			styleSegmentDragState.type !== "moving" &&
			imageSegmentDragState.type !== "moving" &&
			shapeSegmentDragState.type !== "moving" &&
			zoomSegmentDragState.type !== "moving" &&
			sceneSegmentDragState.type !== "moving" &&
			maskSegmentDragState.type !== "moving" &&
			textSegmentDragState.type !== "moving" &&
			audioSegmentDragState.type !== "moving" &&
			captionSegmentDragState.type !== "moving" &&
			keyboardSegmentDragState.type !== "moving" &&
			threeDSegmentDragState.type !== "moving"
		) {
			const newTime = timelineTimeFromClientX(e.clientX);
			if (newTime === null) return;
			await seekPlayheadTo(newTime);
		}
	}

	function beginRulerScrub(downEvent: MouseEvent) {
		if (downEvent.button !== 0) return;
		downEvent.stopPropagation();

		let lastClientX = downEvent.clientX;
		let seekInFlight = false;
		let seekQueued = false;
		let panRafId: number | null = null;

		const contentEdges = () => {
			const metrics = getTimelineContentMetrics();
			if (!metrics || metrics.width <= 0) return null;
			return { left: metrics.left, right: metrics.left + metrics.width };
		};

		// While playing, each seek is a stop/seek/restart round-trip, so scrub
		// updates are coalesced to one in-flight seek with the latest position
		// applied once it settles.
		const applyScrub = () => {
			const edges = contentEdges();
			const clientX = edges
				? Math.min(Math.max(lastClientX, edges.left), edges.right)
				: lastClientX;
			const newTime = timelineTimeFromClientX(clientX);
			if (newTime === null) return;
			if (seekInFlight) {
				seekQueued = true;
				return;
			}
			seekInFlight = true;
			void seekPlayheadTo(newTime).finally(() => {
				seekInFlight = false;
				if (seekQueued) {
					seekQueued = false;
					applyScrub();
				}
			});
		};

		const stepEdgePan = () => {
			panRafId = null;
			const edges = contentEdges();
			if (!edges) return;
			const overshoot =
				lastClientX < edges.left
					? lastClientX - edges.left
					: lastClientX > edges.right
						? lastClientX - edges.right
						: 0;
			if (overshoot === 0) return;
			const panPx =
				Math.sign(overshoot) * Math.min(Math.abs(overshoot) * 0.2, 12);
			transform().setPosition(transform().position + panPx * secsPerPixel());
			applyScrub();
			panRafId = requestAnimationFrame(stepEdgePan);
		};

		const ensureEdgePan = () => {
			if (panRafId === null) panRafId = requestAnimationFrame(stepEdgePan);
		};

		applyScrub();
		ensureEdgePan();

		createRoot((dispose) => {
			onCleanup(() => {
				if (panRafId !== null) {
					cancelAnimationFrame(panRafId);
					panRafId = null;
				}
			});
			createEventListenerMap(window, {
				mousemove: (event) => {
					lastClientX = event.clientX;
					applyScrub();
					ensureEdgePan();
				},
				mouseup: () => {
					setEditorState("timeline", "audioPicker", null);
					dispose();
				},
				blur: () => dispose(),
			});
		});
	}

	useEditorShortcuts(keymap, {
		snap: () => (props.inactive ? false : toggleSnapping()),
		split: () => (props.inactive ? false : timelineCommands.splitAtPlayhead()),
		splitAll: () =>
			props.inactive ? false : timelineCommands.splitAcrossTracks(),
		trimLeft: () =>
			props.inactive ? false : timelineCommands.trimAtPlayhead("start"),
		trimRight: () =>
			props.inactive ? false : timelineCommands.trimAtPlayhead("end"),
		delete: () => (props.inactive ? false : timelineCommands.deleteSelection()),
		selectAll: () => (props.inactive ? false : timelineCommands.selectTrack()),
		deselect: () => (props.inactive ? false : timelineCommands.deselect()),
	});

	const generateCaptionsFromTrack = async () => {
		if (!editorInstance) return;

		setEditorState("captions", "isGenerating", true);

		try {
			const { model, language } = getSelectedTranscriptionSettings();
			const result = await transcribeEditorCaptions(
				editorInstance.path,
				model,
				language,
			);

			if (result.segments.length < 1) {
				toast.error(
					localize(
						"No captions were generated. The audio might be too quiet or unclear.",
					),
				);
				return;
			}

			setProject(
				produce((p) => {
					applyCaptionResultToProject(
						p,
						result.segments,
						editorInstance.recordings.segments,
						duration(),
					);
				}),
			);

			setEditorState("timeline", "tracks", "caption", true);
			setEditorState("captions", "isStale", false);
			toast.success(localize("Captions generated successfully!"));
		} catch (error) {
			const errorMessage = getCaptionGenerationErrorMessage(error);
			toast.error(
				localize("字幕生成失败：{error}", { error: localize(errorMessage) }),
			);
		} finally {
			setEditorState("captions", "isGenerating", false);
		}
	};

	const hoverPreview = createTimelineHoverPreview({
		pointerDown: () => timelinePointerDown,
		playbackIntent,
		metrics: getTimelineContentMetrics,
		position: () => transform().position,
		end: totalDuration,
		secondsPerPixel: secsPerPixel,
		startSnapPixels: START_SNAP_PX,
		setPreviewTime: (time) => setEditorState("previewTime", time),
	});

	const split = () => editorState.timeline.interactMode === "split";
	const [marqueeBox, setMarqueeBox] = createSignal<{
		left: number;
		top: number;
		width: number;
		height: number;
	} | null>(null);

	const isAnyTrackDragging = () =>
		styleSegmentDragState.type !== "idle" ||
		imageSegmentDragState.type !== "idle" ||
		shapeSegmentDragState.type !== "idle" ||
		zoomSegmentDragState.type !== "idle" ||
		sceneSegmentDragState.type !== "idle" ||
		maskSegmentDragState.type !== "idle" ||
		textSegmentDragState.type !== "idle" ||
		audioSegmentDragState.type !== "idle" ||
		captionSegmentDragState.type !== "idle" ||
		keyboardSegmentDragState.type !== "idle" ||
		threeDSegmentDragState.type !== "idle";

	const selectMarqueeRange = (
		minX: number,
		maxX: number,
		minY: number,
		maxY: number,
		anchorY: number,
	) => {
		const scrollEl = timelineScrollRef();
		const metrics = getTimelineContentMetrics();
		if (!scrollEl || !metrics || metrics.width <= 0) return;

		const rawStart =
			transform().position + (minX - metrics.left) * secsPerPixel();
		const rawEnd =
			transform().position + (maxX - metrics.left) * secsPerPixel();
		const rangeStart = Math.max(0, Math.min(rawStart, rawEnd));
		const rangeEnd = Math.max(rangeStart, rawEnd);

		const rows = Array.from(
			scrollEl.querySelectorAll<HTMLElement>("[data-track-type]"),
		);
		const hitsByType = new Map<TimelineTrackType, Set<number>>();
		let anchorType: TimelineTrackType | null = null;

		for (const row of rows) {
			const rect = row.getBoundingClientRect();
			if (rect.bottom < minY || rect.top > maxY) continue;
			const trackType = row.dataset.trackType as TimelineTrackType | undefined;
			if (!trackType) continue;
			if (anchorY >= rect.top && anchorY <= rect.bottom) {
				anchorType = trackType;
			}
			const laneAttr = row.dataset.trackLane;
			const laneIndex =
				laneAttr !== undefined && laneAttr !== ""
					? Number(laneAttr)
					: undefined;
			const segments = getTrackSegments(project.timeline, trackType);
			for (let idx = 0; idx < segments.length; idx++) {
				const seg = segments[idx];
				if (laneIndex !== undefined && getSegmentTrack(seg) !== laneIndex)
					continue;
				if (seg.end > rangeStart && seg.start < rangeEnd) {
					let set = hitsByType.get(trackType);
					if (!set) {
						set = new Set<number>();
						hitsByType.set(trackType, set);
					}
					set.add(idx);
				}
			}
		}

		let chosenType: TimelineTrackType | null = null;
		if (anchorType && (hitsByType.get(anchorType)?.size ?? 0) > 0) {
			chosenType = anchorType;
		} else {
			let bestCount = 0;
			for (const [type, set] of hitsByType) {
				if (set.size > bestCount) {
					bestCount = set.size;
					chosenType = type;
				}
			}
		}

		if (chosenType) {
			const indices = Array.from(hitsByType.get(chosenType) ?? []).sort(
				(a, b) => a - b,
			);
			setEditorState("timeline", "selection", {
				type: chosenType,
				indices,
			});
			setEditorState("timeline", "audioPicker", null);
		} else {
			setEditorState("timeline", "selection", null);
		}
	};

	return (
		<TimelineContextProvider
			duration={totalDuration()}
			secsPerPixel={secsPerPixel()}
			timelineBounds={timelineBounds}
			showSegmentMenu={showSegmentMenu}
			snapping={snapping}
		>
			<div
				ref={setTimelineContainerRef}
				class="relative overflow-hidden flex flex-col gap-1 h-full"
				style={{ "--track-height": TRACK_HEIGHT }}
				onContextMenu={(event) => {
					if (
						event.target instanceof Element &&
						event.target.closest(
							"[data-timeline-segment], button, input, [role='menu'], [role='dialog']",
						)
					)
						return;
					showBlankMenu(event);
				}}
				onMouseDown={(e) => {
					if (e.button !== 0) return;
					const container = e.currentTarget;
					const target = e.target;
					const containerRect = container.getBoundingClientRect();
					const canMarquee =
						!split() &&
						!isAnyTrackDragging() &&
						!(
							target instanceof Element &&
							target.closest(
								"[data-timeline-segment], button, input, [role='menu'], [role='dialog']",
							)
						) &&
						e.clientX >= containerRect.left + TRACK_GUTTER &&
						e.clientY >=
							containerRect.top +
								TIMELINE_HEADER_HEIGHT +
								EDIT_COMMANDS_HEIGHT +
								TIMELINE_HEADER_GAP;
					const startX = e.clientX;
					const startY = e.clientY;
					let didMarquee = false;

					createRoot((dispose) => {
						onCleanup(() => setMarqueeBox(null));
						createEventListenerMap(window, {
							mousemove: (moveEvent) => {
								if (!canMarquee || isAnyTrackDragging()) return;
								if (
									!didMarquee &&
									Math.hypot(
										moveEvent.clientX - startX,
										moveEvent.clientY - startY,
									) < 6
								) {
									return;
								}
								didMarquee = true;
								moveEvent.preventDefault();
								const rect = container.getBoundingClientRect();
								const minX = Math.min(startX, moveEvent.clientX);
								const maxX = Math.max(startX, moveEvent.clientX);
								const minY = Math.min(startY, moveEvent.clientY);
								const maxY = Math.max(startY, moveEvent.clientY);
								const clampedLeft = Math.max(TRACK_GUTTER, minX - rect.left);
								const clampedRight = Math.min(rect.width, maxX - rect.left);
								const clampedTop = Math.max(
									TIMELINE_HEADER_HEIGHT +
										EDIT_COMMANDS_HEIGHT +
										TIMELINE_HEADER_GAP,
									minY - rect.top,
								);
								const clampedBottom = Math.min(rect.height, maxY - rect.top);
								setMarqueeBox({
									left: clampedLeft,
									top: clampedTop,
									width: Math.max(0, clampedRight - clampedLeft),
									height: Math.max(0, clampedBottom - clampedTop),
								});
								selectMarqueeRange(minX, maxX, minY, maxY, startY);
							},
							mouseup: (upEvent) => {
								setMarqueeBox(null);
								if (
									!didMarquee &&
									upEvent.target instanceof Node &&
									container.contains(upEvent.target)
								) {
									handleUpdatePlayhead(e);
									if (zoomSegmentDragState.type === "idle") {
										setEditorState("timeline", "selection", null);
										setEditorState("timeline", "audioPicker", null);
									}
								}
								dispose();
							},
							blur: () => {
								setMarqueeBox(null);
								dispose();
							},
						});
					});
				}}
				onMouseMove={hoverPreview.onMouseMove}
				onMouseEnter={() => setEditorState("timeline", "hoveredTrack", null)}
				onMouseLeave={hoverPreview.onMouseLeave}
				onWheel={(e) => {
					if (e.ctrlKey) {
						const zoomDelta = (e.deltaY * Math.sqrt(transform().zoom)) / 30;
						const origin = editorState.previewTime ?? editorState.playbackTime;
						scheduleZoomUpdate(zoomDelta, origin);
					} else {
						let delta: number = 0;

						if (Math.abs(e.deltaX) > Math.abs(e.deltaY) * 0.5) {
							delta = e.deltaX;
						} else if (platform() === "macos") {
							delta = e.shiftKey ? e.deltaX : e.deltaY;
						} else {
							delta = e.deltaY;
						}

						scheduleScrollUpdate(secsPerPixel() * delta);
					}
				}}
			>
				<div
					role="toolbar"
					aria-label={localize("剪辑工具")}
					class="relative z-50 flex shrink-0 items-center justify-between gap-2 px-1"
					onMouseDown={(event) => event.stopPropagation()}
					onMouseMove={(event) => {
						event.stopPropagation();
						hoverPreview.onMouseLeave(event);
					}}
					style={{ height: `${EDIT_COMMANDS_HEIGHT}px` }}
				>
					<div class="flex min-w-0 items-center gap-1">
						<For
							each={
								[
									{
										command: "selectTool",
										label: "选择工具",
										icon: IconLucideMousePointer2,
										pressed: () => !split(),
										run: () => timelineCommands.setTool("seek"),
									},
									{
										command: "bladeTool",
										label: "分割工具",
										icon: IconCapScissors,
										pressed: split,
										run: () => timelineCommands.setTool("split"),
									},
									{
										command: "split",
										label: "在播放头处分割",
										icon: IconLucideSplit,
										disabled: () => !timelineCommands.canSplitAtPlayhead(),
										run: () => timelineCommands.splitAtPlayhead(),
									},
									{
										command: "trimLeft",
										label: "修剪播放头左侧",
										icon: IconLucideArrowLeftToLine,
										disabled: () =>
											!timelineCommands.canTrimAtPlayhead("start"),
										run: () => timelineCommands.trimAtPlayhead("start"),
									},
									{
										command: "trimRight",
										label: "修剪播放头右侧",
										icon: IconLucideArrowRightToLine,
										disabled: () => !timelineCommands.canTrimAtPlayhead("end"),
										run: () => timelineCommands.trimAtPlayhead("end"),
									},
									{
										command: "splitAll",
										label: "在播放头处分割所有轨道",
										icon: IconLucideScissors,
										disabled: () => !timelineCommands.canSplitAcrossTracks(),
										run: timelineCommands.splitAcrossTracks,
									},
									{
										command: "delete",
										label: "删除",
										icon: IconCapTrash,
										disabled: () => !timelineCommands.canDeleteSelection(),
										run: () => timelineCommands.deleteSelection(),
									},
								] satisfies Array<{
									command?: EditorCommand;
									label: string;
									icon: typeof IconCapScissors;
									pressed?: () => boolean;
									disabled?: () => boolean;
									run: () => void;
								}>
							}
						>
							{(action) => {
								const title = () =>
									[
										localize(action.label),
										action.command && keymap.label(action.command),
									]
										.filter(Boolean)
										.join(" · ");
								return (
									<button
										type="button"
										class={cx(
											"jk-tl-tool-btn flex h-6 shrink-0 items-center justify-center gap-1 rounded-md px-1.5 text-xs focus-visible:outline-ed-accent disabled:opacity-40",
											action.pressed?.()
												? "is-on text-ed-accent"
												: "text-ed-text-2 hover:text-ed-text-1",
										)}
										title={title()}
										aria-label={localize(action.label)}
										aria-pressed={action.pressed?.()}
										disabled={props.inactive || action.disabled?.()}
										onClick={() => action.run()}
									>
										<span class="grid size-3.5 place-items-center [&_svg]:size-3.5">
											<action.icon />
										</span>
									</button>
								);
							}}
						</For>
					</div>

					<div class="jk-tl-right-tools flex shrink-0 items-center gap-1">
						<button
							type="button"
							class={cx(
								"jk-tl-tool-btn grid size-6 place-items-center rounded-md focus-visible:outline-ed-accent",
								mainTrackMagnetic()
									? "is-on text-ed-accent"
									: "text-ed-text-3 hover:text-ed-text-1",
							)}
							aria-label={localize("Main track magnetism")}
							aria-pressed={mainTrackMagnetic()}
							disabled={props.inactive}
							title={localize(
								mainTrackMagnetic()
									? "Main track magnetism is on. Turn off to leave gaps."
									: "Main track magnetism is off. Turn on to close gaps.",
							)}
							onMouseDown={(event) => event.stopPropagation()}
							onClick={toggleMainTrackMagnetism}
						>
							<IconLucideAlignHorizontalDistributeCenter class="size-3.5" />
						</button>
						<button
							type="button"
							class={cx(
								"jk-tl-tool-btn grid size-6 place-items-center rounded-md focus-visible:outline-ed-accent",
								snappingEnabled()
									? "is-on text-ed-accent"
									: "text-ed-text-3 hover:text-ed-text-1",
							)}
							aria-label={localize("时间线吸附")}
							aria-pressed={snappingEnabled()}
							disabled={props.inactive}
							title={[
								localize("时间线吸附"),
								keymap.label("snap"),
								localize("按住 Alt 临时绕过"),
							]
								.filter(Boolean)
								.join(" · ")}
							onMouseDown={(event) => event.stopPropagation()}
							onClick={toggleSnapping}
						>
							<IconLucideMagnet class="size-3.5" />
						</button>
						<div class="flex flex-row gap-0.5 items-center">
							<EditorButton
								tooltipText={localize("缩小时间线")}
								aria-label={localize("缩小时间线")}
								kbd={keymap.kbd("zoomOut")}
								onClick={() => timelineCommands.zoomBy(1.1)}
								leftIcon={<IconCapZoomOut />}
							/>
							<Slider
								class="jk-slider-mini w-16 shrink-0 max-[640px]:hidden"
								aria-label={localize("时间线缩放")}
								minValue={0}
								maxValue={1}
								step={0.001}
								value={[
									Math.min(
										Math.max(
											1 - editorState.timeline.transform.zoom / zoomOutLimit(),
											0,
										),
										1,
									),
								]}
								onChange={([v]) => {
									editorState.timeline.transform.updateZoom(
										(1 - v) * zoomOutLimit(),
										editorState.playbackTime,
									);
								}}
								formatTooltip={() =>
									localize("当前显示 {seconds} 秒", {
										seconds: editorState.timeline.transform.zoom.toFixed(0),
									})
								}
							/>
							<EditorButton
								tooltipText={localize("放大时间线")}
								aria-label={localize("放大时间线")}
								kbd={keymap.kbd("zoomIn")}
								onClick={() => timelineCommands.zoomBy(1 / 1.1)}
								leftIcon={<IconCapZoomIn />}
							/>
							<EditorButton
								tooltipText={localize("显示整个时间线")}
								aria-label={localize("显示整个时间线")}
								kbd={keymap.kbd("fit")}
								onClick={timelineCommands.fit}
								leftIcon={<IconLucideMaximize2 />}
							/>
						</div>
					</div>
				</div>
				<div class="absolute bottom-0 right-0 z-30 h-1 w-[78px]">
					<Minimap />
				</div>
				<div
					class="relative z-20 shrink-0"
					style={{ height: `${TIMELINE_HEADER_HEIGHT}px` }}
				>
					<div class="absolute inset-0 flex items-end">
						<TimelineMarkings />
					</div>
					<div
						class="absolute inset-y-0 left-0 z-30 flex items-center"
						style={{
							width: `${TRACK_ICON_WIDTH}px`,
							"padding-left": `${TRACK_GUTTER_INSET}px`,
						}}
					>
						<TrackManager
							options={trackOptions()}
							open={trackPickerOpen()}
							onOpenChange={setTrackPickerOpen}
							onToggle={handleToggleTrack}
							onAdd={handleAddTrack}
						/>
					</div>

					{/* Scrub surface for the ruler. It overhangs the timeline origin so
					    the snap-to-zero zone places the playhead instead of hitting the
					    "Add track" trigger beneath, without swallowing that trigger. */}
					<div
						class="absolute inset-y-0 right-0 z-40"
						style={{ left: `${TRACK_GUTTER - RULER_SCRUB_OVERHANG_PX}px` }}
						tabIndex={0}
						aria-label={localize("时间尺")}
						onKeyDown={(event) => {
							if (isContextMenuKey(event)) showBlankMenu(event);
						}}
						onMouseDown={beginRulerScrub}
					/>
				</div>
				<Show
					when={
						!playbackIntent() &&
						editorState.previewTime !== null &&
						editorState.timeline.splitPreview === null
							? { time: editorState.previewTime }
							: null
					}
				>
					{(preview) => (
						<div
							class="absolute bottom-0 z-20 w-px pointer-events-none bg-ed-text-3/50"
							style={{
								left: `${TRACK_GUTTER}px`,
								top: `${PLAYHEAD_TOP_OFFSET + EDIT_COMMANDS_HEIGHT + TIMELINE_HEADER_GAP}px`,
								transform: `translateX(${
									((preview().time ?? 0) - transform().position) /
									secsPerPixel()
								}px)`,
							}}
						>
							<div class="absolute top-0 left-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ed-text-3/50" />
						</div>
					)}
				</Show>
				<div
					class={cx(
						"absolute bottom-0 z-20 w-px pointer-events-none bg-ed-playhead",
						split() && "opacity-50",
					)}
					style={{
						left: `${TRACK_GUTTER}px`,
						top: `${PLAYHEAD_TOP_OFFSET + EDIT_COMMANDS_HEIGHT + TIMELINE_HEADER_GAP}px`,
						transform: `translateX(${Math.min(
							(editorState.playbackTime - transform().position) /
								secsPerPixel(),
							timelineBounds.width ?? 0,
						)}px)`,
					}}
				>
					<div class="size-2.5 rounded-[3px] bg-ed-playhead ring-2 ring-ed-card -mt-1 -ml-[4.5px]" />
				</div>
				<Show when={snapGuide() !== null}>
					<div
						aria-hidden="true"
						data-timeline-snap-guide=""
						class="absolute bottom-0 z-30 w-px pointer-events-none bg-ed-accent"
						style={{
							left: `${TRACK_GUTTER}px`,
							top: `${PLAYHEAD_TOP_OFFSET + EDIT_COMMANDS_HEIGHT + TIMELINE_HEADER_GAP}px`,
							transform: `translateX(${((snapGuide() ?? 0) - transform().position) / secsPerPixel()}px)`,
						}}
					/>
				</Show>
				<Show when={split() ? editorState.timeline.splitPreview : null}>
					{(preview) => (
						<div
							class={cx(
								"absolute bottom-0 z-20 w-px pointer-events-none",
								preview().snapped ? "bg-ed-accent" : "bg-ed-text-3/70",
							)}
							style={{
								left: `${TRACK_GUTTER}px`,
								top: `${PLAYHEAD_TOP_OFFSET + EDIT_COMMANDS_HEIGHT + TIMELINE_HEADER_GAP}px`,
								transform: `translateX(${
									(preview().time - transform().position) / secsPerPixel()
								}px)`,
							}}
						>
							<Show when={preview().snapped}>
								<div class="absolute top-0 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[1px] bg-ed-accent" />
							</Show>
						</div>
					)}
				</Show>
				<blankMenu.Content />
				<segmentMenu.Content />
				<div class="overflow-hidden relative flex-1 min-h-0">
					<div
						ref={setTimelineScrollRef}
						data-track-scroll
						class="absolute inset-0 overflow-y-auto overflow-x-hidden pr-1"
						onWheel={(e) => {
							if (!e.ctrlKey && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
								e.stopPropagation();
							}
						}}
					>
						<div class="flex flex-col gap-1.5 min-h-full">
							<BookmarkTrack gutter={TRACK_GUTTER} />
							<TrackRow
								icon={trackIcons.clip}
								label={localize("Video")}
								type="clip"
							>
								<ClipTrack ref={setTimelineRef} />
							</TrackRow>
							<Show when={captionTrackVisible()}>
								<TrackRow
									icon={trackIcons.caption}
									label={localize("Captions")}
									type="caption"
									onDelete={() => handleDeleteSingleTrack("caption")}
								>
									<CaptionsTrack
										onDragStateChanged={(v) => {
											captionSegmentDragState = v;
										}}
										handleUpdatePlayhead={handleUpdatePlayhead}
										onGenerate={generateCaptionsFromTrack}
										isGenerating={editorState.captions.isGenerating}
									/>
								</TrackRow>
							</Show>
							<Show when={keyboardTrackVisible()}>
								<TrackRow
									icon={trackIcons.keyboard}
									label={localize("Keyboard")}
									type="keyboard"
									onDelete={() => handleDeleteSingleTrack("keyboard")}
								>
									<KeyboardTrack
										onDragStateChanged={(v) => {
											keyboardSegmentDragState = v;
										}}
										handleUpdatePlayhead={handleUpdatePlayhead}
									/>
								</TrackRow>
							</Show>
							<For each={styleTrackRows()}>
								{(laneIndex) => (
									<TrackRow
										icon={trackIcons.style}
										label={localize("样式 {number}", { number: laneIndex + 1 })}
										type="style"
										laneIndex={laneIndex}
										onDelete={() => handleDeleteTrackLane("style", laneIndex)}
									>
										<StyleTrack
											laneIndex={laneIndex}
											onDragStateChanged={(value) => {
												styleSegmentDragState = value;
											}}
											handleUpdatePlayhead={handleUpdatePlayhead}
										/>
									</TrackRow>
								)}
							</For>
							<For each={overlayTrackRows()}>
								{(row) => (
									<TrackRow
										icon={trackIcons[row.kind]}
										label={localize("{type} {number}", {
											type: localize(
												row.kind === "image"
													? "Image"
													: row.kind === "shape"
														? "Shape"
														: row.kind === "text"
															? "Text"
															: "Mask",
											),
											number: row.track + 1,
										})}
										type={row.kind}
										laneIndex={row.track}
										onDelete={() => handleDeleteTrackLane(row.kind, row.track)}
									>
										<Switch>
											<Match when={row.kind === "image"}>
												<ImageTrack
													laneIndex={row.track}
													onDragStateChanged={(value) => {
														imageSegmentDragState = value;
													}}
													handleUpdatePlayhead={handleUpdatePlayhead}
												/>
											</Match>
											<Match when={row.kind === "shape"}>
												<ShapeTrack
													laneIndex={row.track}
													onDragStateChanged={(value) => {
														shapeSegmentDragState = value;
													}}
													handleUpdatePlayhead={handleUpdatePlayhead}
												/>
											</Match>
											<Match when={row.kind === "text"}>
												<TextTrack
													laneIndex={row.track}
													onDragStateChanged={(value) => {
														textSegmentDragState = value;
													}}
													handleUpdatePlayhead={handleUpdatePlayhead}
												/>
											</Match>
											<Match when={row.kind === "mask"}>
												<MaskTrack
													laneIndex={row.track}
													onDragStateChanged={(value) => {
														maskSegmentDragState = value;
													}}
													handleUpdatePlayhead={handleUpdatePlayhead}
												/>
											</Match>
										</Switch>
									</TrackRow>
								)}
							</For>
							<For each={audioTrackRows()}>
								{(laneIndex) => (
									<TrackRow
										icon={trackIcons.audio}
										label={localize("音频 {number}", { number: laneIndex + 1 })}
										type="audio"
										laneIndex={laneIndex}
										onDelete={() => handleDeleteTrackLane("audio", laneIndex)}
									>
										<AudioTrack
											laneIndex={laneIndex}
											onDragStateChanged={(v) => {
												audioSegmentDragState = v;
											}}
											handleUpdatePlayhead={handleUpdatePlayhead}
											onRequestAdd={timelineCommands.openAudioMaterials}
										/>
									</TrackRow>
								)}
							</For>
							<TrackRow
								icon={trackIcons.zoom}
								label={localize("Zoom")}
								type="zoom"
								onDelete={
									(project.timeline?.zoomSegments?.length ?? 0) > 0
										? () => handleClearTrackSegments("zoom")
										: undefined
								}
								deleteTitle="Delete all zoom segments"
							>
								<ZoomTrack
									onDragStateChanged={(v) => {
										zoomSegmentDragState = v;
									}}
									handleUpdatePlayhead={handleUpdatePlayhead}
								/>
							</TrackRow>
							<Show when={threeDTrackVisible()}>
								<TrackRow
									icon={trackIcons["3d"]}
									label="3D"
									type="3d"
									onDelete={
										(project.timeline?.camera3dSegments?.length ?? 0) > 0
											? () => handleClearTrackSegments("3d")
											: undefined
									}
									deleteTitle="Delete all 3D shots"
								>
									<ThreeDTrack
										onDragStateChanged={(v) => {
											threeDSegmentDragState = v;
										}}
										handleUpdatePlayhead={handleUpdatePlayhead}
									/>
								</TrackRow>
							</Show>
							<Show when={sceneTrackVisible()}>
								<TrackRow
									icon={trackIcons.scene}
									label={localize("Scene")}
									type="scene"
									onDelete={
										(project.timeline?.sceneSegments?.length ?? 0) > 0
											? () => handleClearTrackSegments("scene")
											: undefined
									}
									deleteTitle="Delete all scene segments"
								>
									<SceneTrack
										onDragStateChanged={(v) => {
											sceneSegmentDragState = v;
										}}
										handleUpdatePlayhead={handleUpdatePlayhead}
									/>
								</TrackRow>
							</Show>
						</div>
					</div>
				</div>
				<Show when={marqueeBox()}>
					{(box) => (
						<div
							aria-hidden="true"
							data-timeline-marquee=""
							class="pointer-events-none absolute z-40 rounded-sm border border-ed-accent bg-ed-accent/15"
							style={{
								left: `${box().left}px`,
								top: `${box().top}px`,
								width: `${box().width}px`,
								height: `${box().height}px`,
							}}
						/>
					)}
				</Show>
			</div>
		</TimelineContextProvider>
	);
}

function getTrackSegments(
	timeline: EditorProjectConfiguration["timeline"],
	type: TimelineTrackType,
): Array<{
	start: number;
	end: number;
	track?: number;
}> {
	switch (type) {
		case "style":
			return timeline?.styleSegments ?? [];
		case "image":
			return timeline?.imageSegments ?? [];
		case "shape":
			return timeline?.shapeSegments ?? [];
		case "text":
			return timeline?.textSegments ?? [];
		case "mask":
			return timeline?.maskSegments ?? [];
		case "audio":
			return timeline?.audioSegments ?? [];
		case "caption":
			return timeline?.captionSegments ?? [];
		case "keyboard":
			return timeline?.keyboardSegments ?? [];
		case "zoom":
			return timeline?.zoomSegments ?? [];
		case "3d":
			return timeline?.camera3dSegments ?? [];
		case "scene":
			return timeline?.sceneSegments ?? [];
		case "clip": {
			const segments = timeline?.segments ?? [];
			const offsets = clipTimelineOffsets(
				segments,
				timeline?.transitions ?? [],
				timeline?.mainTrackGaps,
			);
			const holds = holdWindows(timeline?.textSegments);
			return segments.map((segment, index) => ({
				start: effectiveToOutput(holds, offsets[index]),
				end: clipEndOnOutput(
					holds,
					segments,
					index,
					offsets[index] + clipDuration(segment),
					timeline?.mainTrackGaps,
				),
			}));
		}
	}
}

function TrackRow(props: {
	icon: () => JSX.Element;
	label?: string;
	type: TimelineTrackType;
	laneIndex?: number;
	children: JSX.Element;
	onDelete?: () => void;
	deleteTitle?: string;
}) {
	const { project, setProject, editorState, setEditorState, timelineCommands } =
		useEditorContext();
	const menu = createEditorContextMenu();
	const [dragging, setDragging] = createSignal(false);
	let suppressClick = false;
	let finishDrag: (() => void) | undefined;
	onCleanup(() => finishDrag?.());
	const overlayRows = () =>
		getOverlayTrackRows(project, editorState.timeline.tracks);
	const moveToSlot = (slot: number) => {
		const from = props.laneIndex;
		if (from === undefined) return;
		if (isOverlayTrackKind(props.type)) {
			const order = overlayRows();
			const source = { kind: props.type, track: from };
			if (order.findIndex((item) => sameOverlayTrack(item, source)) === slot)
				return;
			setProject("overlayOrder", moveOverlayTrack(order, source, slot));
			return;
		}
		const to = laneCount() - 1 - slot;
		if (from === to) return;
		setProject(
			"timeline",
			produce((timeline) => {
				if (!timeline) return;
				if (props.type === "style")
					moveTrackLane(timeline.styleSegments, from, to);
				else if (props.type === "audio")
					moveTrackLane(timeline.audioSegments ?? [], from, to);
			}),
		);
	};
	const trackSegments = () => getTrackSegments(project.timeline, props.type);
	const laneCount = () => {
		const count = editorState.timeline.tracks[props.type];
		return Math.max(
			typeof count === "number" ? count : 0,
			getUsedTrackCount(trackSegments()),
		);
	};
	const active = () => {
		const selection = editorState.timeline.selection;
		if (
			!selection ||
			selection.type !== props.type ||
			!("indices" in selection)
		)
			return false;
		if (props.laneIndex === undefined) return true;
		const segments = trackSegments();
		return selection.indices.some((index) => {
			const segment = segments[index];
			return (
				segment !== undefined && getSegmentTrack(segment) === props.laneIndex
			);
		});
	};
	const selectTrack = () => {
		const segments = trackSegments();
		const items = segments
			.map((segment, index) => ({ segment, index }))
			.filter(
				({ segment }) =>
					props.laneIndex === undefined ||
					getSegmentTrack(segment) === props.laneIndex,
			);
		const time = editorState.playbackTime;
		const activeItems = props.type === "clip" ? [...items].reverse() : items;
		const item =
			activeItems.find(
				({ segment }) => time >= segment.start && time < segment.end,
			) ?? items[0];
		batch(() => {
			setEditorState("timeline", "audioPicker", null);
			setEditorState("timeline", "audioReplace", null);
			setEditorState(
				"timeline",
				"selection",
				item ? { type: props.type, indices: [item.index] } : null,
			);
			if (item) {
				setEditorState("previewTime", null);
				setEditorState(
					"playbackTime",
					Math.max(
						item.segment.start,
						Math.min(time, item.segment.end - 0.001),
					),
				);
			}
		});
	};

	const showTrackMenu = (event: MouseEvent | KeyboardEvent) => {
		const remove = props.onDelete;
		menu.show(event, props.label ?? props.type, [
			{
				label: localize("选中此轨道的全部片段"),
				disabled: !trackSegments().some(
					(segment) =>
						props.laneIndex === undefined ||
						getSegmentTrack(segment) === props.laneIndex,
				),
				run: () => timelineCommands.selectTrack(props.type, props.laneIndex),
			},
			...(remove
				? [
						{
							label: localize(props.deleteTitle ?? "删除轨道"),
							danger: true,
							run: remove,
						},
					]
				: []),
		]);
	};

	const canReorder = () =>
		props.laneIndex !== undefined &&
		(isOverlayTrackKind(props.type) ? overlayRows().length : laneCount()) > 1;
	const reorderWithKeyboard = (event: KeyboardEvent) => {
		if (
			!canReorder() ||
			!event.altKey ||
			!["ArrowUp", "ArrowDown"].includes(event.key)
		)
			return;
		event.preventDefault();
		event.stopPropagation();
		const kind = props.type;
		const visual = isOverlayTrackKind(kind);
		const count = visual ? overlayRows().length : laneCount();
		const from = visual
			? overlayRows().findIndex(
					(item) => item.kind === kind && item.track === props.laneIndex,
				)
			: count - 1 - (props.laneIndex ?? 0);
		const to = Math.max(
			0,
			Math.min(count - 1, from + (event.key === "ArrowUp" ? -1 : 1)),
		);
		const rows = (event.currentTarget as HTMLElement).closest(
			"[data-track-lane]",
		)?.parentElement;
		moveToSlot(to);
		if (!visual)
			rows
				?.querySelector<HTMLButtonElement>(
					`[data-track-type="${kind}"][data-track-lane="${count - 1 - to}"] [data-track-reorder]`,
				)
				?.focus();
	};
	const startReorder = (event: MouseEvent) => {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		(event.currentTarget as HTMLElement).focus({ preventScroll: true });
		if (!canReorder()) return;
		finishDrag?.();
		suppressClick = false;
		const header = event.currentTarget as HTMLElement;
		const row = header.closest<HTMLElement>("[data-track-lane]");
		const scroll = row?.closest<HTMLElement>("[data-track-scroll]");
		if (!row || !scroll) return;
		const visual = isOverlayTrackKind(props.type);
		const allRows = Array.from(
			row.parentElement?.querySelectorAll<HTMLElement>("[data-track-lane]") ??
				[],
		).filter((item) =>
			visual
				? isOverlayTrackKind(item.dataset.trackType ?? "")
				: item.dataset.trackType === props.type,
		);
		const rows = allRows.filter((item) => item !== row);
		let target: number | null = null;
		let pointer = { x: event.clientX, y: event.clientY };
		let ghost: HTMLElement | undefined;
		let indicator: HTMLElement | undefined;
		let frame = 0;
		let lastFrame = 0;
		const previousCursor = document.body.style.cursor;
		const updateTarget = () => {
			if (!ghost || !indicator) return;
			ghost.style.transform = `translate(${pointer.x + 14}px, ${pointer.y - 22}px)`;
			const bounds = scroll.getBoundingClientRect();
			const hoveredRow = document
				.elementFromPoint(pointer.x, pointer.y)
				?.closest<HTMLElement>("[data-track-type]");
			if (
				(hoveredRow && !allRows.includes(hoveredRow)) ||
				allRows.some((item) => !item.isConnected) ||
				pointer.x < bounds.left ||
				pointer.x > bounds.right ||
				pointer.y < bounds.top ||
				pointer.y > bounds.bottom
			) {
				target = null;
				indicator.style.display = "none";
				return;
			}
			const rects = rows.map((item) => item.getBoundingClientRect());
			target = trackInsertionIndex(
				rects.map((rect) => rect.top + rect.height / 2),
				pointer.y,
			);
			const after = rects[target];
			const before = rects[target - 1];
			const top = after
				? before
					? (before.bottom + after.top) / 2
					: after.top - 4
				: before.bottom + 4;
			indicator.style.display = "block";
			indicator.style.left = `${bounds.left}px`;
			indicator.style.top = `${Math.max(bounds.top + 1, Math.min(bounds.bottom - 3, top - 1))}px`;
			indicator.style.width = `${bounds.width - 4}px`;
			indicator.textContent = visual
				? target === 0
					? localize("置于最前")
					: target === rows.length
						? localize("置于最后")
						: localize("放置于此")
				: localize("放置于此");
		};
		const tick = (now: number) => {
			const bounds = scroll.getBoundingClientRect();
			const elapsed = Math.min(32, lastFrame ? now - lastFrame : 16);
			lastFrame = now;
			if (
				pointer.x >= bounds.left &&
				pointer.x <= bounds.right &&
				pointer.y >= bounds.top - 24 &&
				pointer.y <= bounds.bottom + 24
			) {
				const edge = Math.min(40, bounds.height / 3);
				const velocity =
					pointer.y < bounds.top + edge
						? -Math.min(1, (bounds.top + edge - pointer.y) / edge)
						: pointer.y > bounds.bottom - edge
							? Math.min(1, (pointer.y - bounds.bottom + edge) / edge)
							: 0;
				scroll.scrollTop += velocity * elapsed * 0.55;
			}
			updateTarget();
			frame = requestAnimationFrame(tick);
		};
		const move = (next: MouseEvent) => {
			pointer = { x: next.clientX, y: next.clientY };
			if (
				!dragging() &&
				Math.hypot(pointer.x - event.clientX, pointer.y - event.clientY) < 4
			)
				return;
			next.preventDefault();
			next.stopPropagation();
			if (!dragging()) {
				setDragging(true);
				suppressClick = true;
				document.body.style.cursor = "grabbing";
				ghost = header.cloneNode(true) as HTMLElement;
				ghost.removeAttribute("data-track-reorder");
				ghost.setAttribute("aria-hidden", "true");
				ghost.style.cssText = `position:fixed;left:0;top:0;width:${header.offsetWidth}px;pointer-events:none;z-index:2147483647;opacity:.95;filter:drop-shadow(0 8px 16px #0006);`;
				indicator = document.createElement("div");
				indicator.style.cssText =
					"position:fixed;height:2px;background:var(--blue-9);color:var(--blue-9);font-size:10px;font-weight:600;line-height:22px;pointer-events:none;z-index:2147483646;text-align:right;";
				document.body.append(ghost, indicator);
				frame = requestAnimationFrame(tick);
			}
			updateTarget();
		};
		const finish = (commit: boolean) => {
			window.removeEventListener("mousemove", move, true);
			window.removeEventListener("mouseup", drop, true);
			window.removeEventListener("blur", cancel);
			window.removeEventListener("keydown", keydown, true);
			cancelAnimationFrame(frame);
			ghost?.remove();
			indicator?.remove();
			document.body.style.cursor = previousCursor;
			const shouldCommit =
				commit &&
				dragging() &&
				target !== null &&
				allRows.every((item) => item.isConnected);
			setDragging(false);
			finishDrag = undefined;
			if (shouldCommit && target !== null) moveToSlot(target);
		};
		const drop = (next: MouseEvent) => {
			move(next);
			finish(true);
		};
		const cancel = () => finish(false);
		const keydown = (next: KeyboardEvent) => {
			if (next.key === "Escape") {
				next.preventDefault();
				next.stopImmediatePropagation();
				cancel();
			}
		};
		finishDrag = cancel;
		window.addEventListener("mousemove", move, true);
		window.addEventListener("mouseup", drop, true);
		window.addEventListener("blur", cancel);
		window.addEventListener("keydown", keydown, true);
	};

	return (
		<div
			class={cx(
				"jk-track-row group/row relative flex items-stretch rounded-[7px] transition-[background-color,opacity] duration-150",
				active() ? "is-active" : "",
			)}
			classList={{ "opacity-35": dragging() }}
			data-track-type={props.type}
			data-track-lane={props.laneIndex}
		>
			<div
				class="group/icon relative shrink-0"
				style={{ width: `${TRACK_ICON_WIDTH}px` }}
				onContextMenu={showTrackMenu}
			>
				<button
					type="button"
					class="relative flex h-full w-full items-center gap-1.5 rounded-md pl-1 text-left focus-visible:outline-2 focus-visible:outline-ed-accent"
					classList={{ "cursor-grab active:cursor-grabbing": canReorder() }}
					data-track-reorder={canReorder() ? "" : undefined}
					title={
						canReorder()
							? localize(
									"拖动轨道标题可调整顺序，上方的画面图层会显示在前面。也可按 Alt + ↑ 或 ↓ 调整。",
								)
							: undefined
					}
					onMouseDown={startReorder}
					onKeyDown={(event) => {
						if (isContextMenuKey(event)) showTrackMenu(event);
						else reorderWithKeyboard(event);
					}}
					aria-label={localize("选择轨道：{track}", {
						track: props.label ?? props.type,
					})}
					onClick={(event) => {
						event.stopPropagation();
						if (suppressClick) {
							suppressClick = false;
							return;
						}
						selectTrack();
					}}
				>
					<TrackIcon
						icon={props.icon()}
						showGrip={canReorder()}
						type={props.type}
					/>
					<Show when={props.label}>
						<span
							class={cx(
								"min-w-0 flex-1 truncate text-[11px] font-medium leading-none transition-[padding,color] duration-150",
								active()
									? "text-ed-text-1"
									: "text-ed-text-2 group-hover/row:text-ed-text-1",
							)}
							classList={{ "group-hover/icon:pr-5": !!props.onDelete }}
						>
							{props.label}
						</span>
					</Show>
				</button>
				<Show when={props.onDelete}>
					<button
						type="button"
						class="absolute right-0 top-1/2 z-30 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-ed-text-3 opacity-0 transition-opacity hover:bg-ed-ctl-active hover:text-red-9 group-hover/icon:opacity-100 focus-visible:opacity-100"
						aria-label={localize(props.deleteTitle ?? "删除轨道")}
						onClick={(e) => {
							e.stopPropagation();
							props.onDelete?.();
						}}
						onMouseDown={(e) => e.stopPropagation()}
						title={localize(props.deleteTitle ?? "删除轨道")}
					>
						<IconCapTrash class="size-3.5" />
					</button>
				</Show>
			</div>
			<div class="flex-1 relative overflow-hidden min-w-0 rounded-r-lg">
				{props.children}
			</div>
			<menu.Content />
		</div>
	);
}

function TimelineMarkings() {
	const { editorState } = useEditorContext();
	const { secsPerPixel, markingResolution } = useTimelineContext();
	const transform = () => editorState.timeline.transform;

	const markingCount = () =>
		Math.ceil(2 + (transform().zoom + 5) / markingResolution());

	const markingOffset = () => transform().position % markingResolution();

	const getMarkingTime = (index: number) =>
		transform().position - markingOffset() + index * markingResolution();

	return (
		<div
			class="relative flex-1 h-full overflow-hidden"
			style={{ "margin-left": `${TRACK_GUTTER}px` }}
		>
			<Index each={Array.from({ length: markingCount() })}>
				{(_, index) => {
					const second = () => getMarkingTime(index);
					const isVisible = () => second() >= 0;
					const isMajor = () => second() % 1 === 0;
					const translateX = () =>
						(second() - transform().position) / secsPerPixel();

					return (
						<div
							class={cx(
								"absolute left-0 bottom-0 w-px bg-ed-line-strong",
								isMajor() ? "h-2" : "h-[5px]",
							)}
							style={{
								transform: `translateX(${translateX()}px)`,
								visibility: isVisible() ? "visible" : "hidden",
							}}
						>
							<Show when={isMajor()}>
								<div
									class={cx(
										"absolute bottom-2.5 left-0 text-[11px] leading-none tabular-nums whitespace-nowrap text-ed-text-3",
										// Left-anchor the origin label so it doesn't overhang
										// into the track icon gutter and get covered
										second() !== 0 && "-translate-x-1/2",
									)}
								>
									{formatTime(second())}
								</div>
							</Show>
						</div>
					);
				}}
			</Index>
		</div>
	);
}
