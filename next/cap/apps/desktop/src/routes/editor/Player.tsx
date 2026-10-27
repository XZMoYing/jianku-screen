import { Select as KSelect } from "@kobalte/core/select";
import { ToggleButton as KToggleButton } from "@kobalte/core/toggle-button";
import { createElementBounds } from "@solid-primitives/bounds";
import { createEventListener } from "@solid-primitives/event-listener";
import { debounce } from "@solid-primitives/scheduled";
import { Menu } from "@tauri-apps/api/menu";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { type as ostype } from "@tauri-apps/plugin-os";
import { cx } from "cva";
import {
	createEffect,
	createSignal,
	on,
	onMount,
	Show,
	untrack,
	type ValidComponent,
} from "solid-js";
import Tooltip from "~/components/Tooltip";
import { captionsStore } from "~/store/captions";
import { createTauriEventListener } from "~/utils/createEventListener";
import { t as localize } from "~/utils/i18n";
import { commands, type PreviewResolutionOption } from "~/utils/tauri";
import AspectRatioSelect from "./AspectRatioSelect";
import {
	CanvasElementsOverlay,
	SnapGuidesOverlay,
} from "./CanvasElementsOverlay";
import { CaptionOverlay } from "./CaptionOverlay";
import { CaptionsRegenerateBadge } from "./CaptionsRegenerateBadge";
import { createCaptionTrackSegments } from "./captions";
import { FPS, useEditorContext } from "./context";
import { FrameButton } from "./FrameButton";
import { ImageOverlay } from "./image-overlay";
import { MaskOverlay } from "./MaskOverlay";
import { PerformanceOverlay } from "./PerformanceOverlay";
import { usePreparingEditor } from "./preparing-editor-context";
import { PreparingFrame } from "./preparing-frame";
import {
	createPreviewBoundsReaction,
	createPreviewBoundsUpdater,
} from "./preview-bounds";
import { previewQualityLabel } from "./preview-resolution";
import { SplitScreenOverlay } from "./SplitScreenOverlay";
import { TextOverlay } from "./TextOverlay";
import {
	EditorButton,
	MenuItem,
	MenuItemList,
	PopperContent,
	Slider,
	topSlideAnimateClasses,
} from "./ui";
import { useEditorShortcuts } from "./useEditorShortcuts";
import { formatTime } from "./utils";

export function PlayerContent(props: { compactness?: number }) {
	const {
		previewStyle,
		selectedStyle,
		toggleStyleGroup,
		styleScopeToken,
		project,
		flushProjectConfig,
		editorInstance,
		setDialog,
		totalDuration,
		editorState,
		setEditorState,
		zoomOutLimit,
		setProject,
		previewResolutionBase,
		previewResolutionOptions,
		previewResolutionOption,
		setPreviewQuality,
		playbackIntent,
		requestHandoffPlayback,
		handoffPlaybackPending,
	} = useEditorContext();

	let panelRef: HTMLDivElement | undefined;
	const [panelHovered, setPanelHovered] = createSignal(false);
	const [previewPointerDown, setPreviewPointerDown] = createSignal(false);

	createEventListener(window, "mouseup", (event) => {
		if (event.button !== 0 || !previewPointerDown()) return;
		const bounds = panelRef?.getBoundingClientRect();
		setPanelHovered(
			!!bounds &&
				event.clientX >= bounds.left &&
				event.clientX < bounds.right &&
				event.clientY >= bounds.top &&
				event.clientY < bounds.bottom,
		);
		setPreviewPointerDown(false);
	});
	createEventListener(window, "blur", () => {
		setPanelHovered(false);
		setPreviewPointerDown(false);
	});

	const zoomHint = () =>
		ostype() === "windows"
			? localize("按住 Ctrl 滚动鼠标滚轮，或按 Ctrl + / - 缩放")
			: localize("双指捏合，或按 Command + / - 缩放");

	// Load captions on mount
	onMount(async () => {
		if (editorInstance?.path) {
			await captionsStore.loadCaptions(editorInstance.path);

			if (editorInstance && project) {
				const updatedProject = { ...project };
				let projectDidChange = false;
				const captionSegments = captionsStore.state.segments;
				const hasStoredCaptions = captionSegments.length > 0;

				if (!updatedProject.captions && hasStoredCaptions) {
					updatedProject.captions = {
						segments: captionSegments.map((segment) => ({
							id: segment.id,
							start: segment.start,
							end: segment.end,
							text: segment.text,
						})),
						settings: { ...captionsStore.state.settings },
						sourceTimed: true,
					};
					projectDidChange = true;
				}

				if (
					hasStoredCaptions &&
					(updatedProject.timeline?.captionSegments?.length ?? 0) === 0
				) {
					updatedProject.timeline = {
						...(updatedProject.timeline ?? {
							segments: [
								{
									start: 0,
									end: editorInstance.recordingDuration,
									timescale: 1,
								},
							],
							zoomSegments: [],
							sceneSegments: [],
							maskSegments: [],
							textSegments: [],
							styleSegments: [],
							imageSegments: [],
							camera3dSegments: [],
							transitions: [],
						}),
						captionSegments: createCaptionTrackSegments(captionSegments),
					};
					projectDidChange = true;
				}

				const hasCaptionTrackData =
					hasStoredCaptions ||
					(updatedProject.timeline?.captionSegments?.length ?? 0) > 0;

				if (hasCaptionTrackData) {
					setEditorState(
						"timeline",
						"tracks",
						"caption",
						updatedProject.captions?.settings?.enabled ?? true,
					);
				}

				if (projectDidChange) {
					setProject(updatedProject);
					await flushProjectConfig();
				}
			}
		}
	});

	// Continue to update current caption when playback time changes
	// This is still needed for CaptionsTab to highlight the current caption
	createEffect(() => {
		const time = editorState.playbackTime;
		// Only update captions if we have a valid time and segments exist
		if (
			time !== undefined &&
			time >= 0 &&
			captionsStore.state.segments.length > 0
		) {
			captionsStore.updateCurrentCaption(time);
		}
	});

	const isAtEnd = () => {
		const total = totalDuration();
		return total > 0 && total - editorState.playbackTime <= 0.1;
	};

	const cropDialogHandler = async () => {
		const background = selectedStyle()
			? (selectedStyle()?.overrides.background ?? previewStyle().background)
			: project.background;
		if (selectedStyle() && !selectedStyle()?.overrides.background)
			toggleStyleGroup("background", true);
		const styleTarget = editorState.styleEditIndex;
		const scopeToken = styleScopeToken();
		const display = editorInstance.recordings.segments[0].display;
		setDialog({
			open: true,
			type: "crop",
			styleTarget,
			scopeToken,
			position: {
				...(background.crop?.position ?? { x: 0, y: 0 }),
			},
			size: {
				...(background.crop?.size ?? {
					x: display.width,
					y: display.height,
				}),
			},
		});
		const pending = requestHandoffPlayback(false);
		if (pending) {
			await pending;
			return;
		}
		await commands.stopPlayback();
		setEditorState("playing", false);
	};

	createEffect(() => {
		if (isAtEnd() && playbackIntent()) {
			const pending = requestHandoffPlayback(false);
			if (pending) return;
			commands.stopPlayback();
			setEditorState("playing", false);
		}
	});

	const handlePlayPauseClick = async () => {
		const pending = requestHandoffPlayback(
			isAtEnd() || !playbackIntent(),
			isAtEnd() ? 0 : undefined,
		);
		if (pending) {
			await pending;
			return;
		}
		try {
			if (isAtEnd()) {
				await commands.stopPlayback();
				setEditorState("playbackTime", 0);
				await commands.seekTo(0);
				await commands.startPlayback(FPS, previewResolutionBase());
				setEditorState("playing", true);
			} else if (editorState.playing) {
				await commands.stopPlayback();
				setEditorState("playing", false);
			} else {
				await commands.seekTo(Math.floor(editorState.playbackTime * FPS));
				await commands.startPlayback(FPS, previewResolutionBase());
				setEditorState("playing", true);
			}
			if (editorState.playing) setEditorState("previewTime", null);
		} catch (error) {
			console.error("Error handling play/pause:", error);
			setEditorState("playing", false);
		}
	};

	if (import.meta.env.DEV) {
		createTauriEventListener<boolean>(
			{
				listen: (callback) =>
					getCurrentWebviewWindow().listen(
						"cap-dev-set-editor-playback",
						callback,
					),
			},
			(playing) => {
				if (playbackIntent() !== playing) void handlePlayPauseClick();
			},
		);
	}

	// Register keyboard shortcuts in one place
	useEditorShortcuts(() => {
		const el = document.activeElement;
		if (!el) return true;
		const tagName = el.tagName.toLowerCase();
		const isContentEditable = el.getAttribute("contenteditable") === "true";
		return !(
			tagName === "input" ||
			tagName === "textarea" ||
			isContentEditable
		);
	}, [
		{
			combo: "S",
			handler: () =>
				setEditorState(
					"timeline",
					"interactMode",
					editorState.timeline.interactMode === "split" ? "seek" : "split",
				),
		},
		{
			combo: "Mod+=",
			handler: () =>
				editorState.timeline.transform.updateZoom(
					editorState.timeline.transform.zoom / 1.1,
					editorState.playbackTime,
				),
		},
		{
			combo: "Mod+-",
			handler: () =>
				editorState.timeline.transform.updateZoom(
					editorState.timeline.transform.zoom * 1.1,
					editorState.playbackTime,
				),
		},
		{
			combo: "Space",
			handler: async () => {
				const prevTime = editorState.previewTime;

				if (!playbackIntent()) {
					if (prevTime !== null) setEditorState("playbackTime", prevTime);

					if (!handoffPlaybackPending())
						await commands.seekTo(Math.floor(editorState.playbackTime * FPS));
				}

				await handlePlayPauseClick();
			},
		},
	]);

	return (
		<div
			ref={panelRef}
			class="flex flex-col flex-1 min-h-0"
			style={{
				"--preview-controls-opacity":
					panelHovered() || previewPointerDown() ? 1 : 0,
			}}
			onMouseEnter={() => setPanelHovered(true)}
			onMouseLeave={() => setPanelHovered(false)}
		>
			<div
				class="flex overflow-x-auto relative z-10 flex-none flex-row gap-3 items-center px-3"
				style={{ height: `${44 - 4 * (props.compactness ?? 0)}px` }}
			>
				<div class="flex flex-1 gap-0.5 items-center min-w-fit">
					<Show when={!selectedStyle()}>
						<AspectRatioSelect />
					</Show>
					<EditorButton
						variant="text"
						tooltipText={localize("Crop Video")}
						onClick={cropDialogHandler}
						leftIcon={<IconCapCrop />}
					>
						<span class="max-[1200px]:hidden">{localize("Crop")}</span>
					</EditorButton>
					<FrameButton />
				</div>
				<div class="flex flex-row flex-none gap-2 items-center">
					<span class="text-xs text-ed-text-2">{localize("Preview")}</span>
					<KSelect<PreviewResolutionOption>
						options={previewResolutionOptions()}
						optionValue="quality"
						optionTextValue={(option) => localize(previewQualityLabel(option))}
						optionDisabled={(option) => !option.available}
						value={previewResolutionOption()}
						onChange={(option) => {
							if (option?.available) setPreviewQuality(option.quality);
						}}
						disallowEmptySelection
						itemComponent={(itemProps) => (
							<MenuItem<typeof KSelect.Item>
								as={KSelect.Item}
								item={itemProps.item}
								class="gap-4"
							>
								<KSelect.ItemLabel class="flex-1">
									{localize(previewQualityLabel(itemProps.item.rawValue))}
								</KSelect.ItemLabel>
								<span class="text-xs text-ed-text-3 tabular-nums">
									{itemProps.item.rawValue.available
										? `${itemProps.item.rawValue.outputSize.x} × ${itemProps.item.rawValue.outputSize.y}`
										: localize("不可用")}
								</span>
							</MenuItem>
						)}
					>
						<KSelect.Trigger
							aria-label={localize("预览清晰度")}
							title={`${localize(previewQualityLabel(previewResolutionOption()))} · ${previewResolutionOption().outputSize.x} × ${previewResolutionOption().outputSize.y}`}
							class="flex flex-row gap-2 items-center px-3 h-8 min-w-24 max-w-40 rounded-full bg-ed-ctl text-xs text-ed-text-1 outline-hidden focus-visible:ring-2 focus-visible:ring-ed-accent"
						>
							<KSelect.Value<PreviewResolutionOption> class="flex-1 text-left truncate">
								{(state) =>
									localize(previewQualityLabel(state.selectedOption()))
								}
							</KSelect.Value>
							<KSelect.Icon<ValidComponent>
								as={(iconProps) => (
									<IconCapChevronDown
										{...iconProps}
										class="size-3.5 shrink-0"
									/>
								)}
							/>
						</KSelect.Trigger>
						<KSelect.Portal>
							<PopperContent<typeof KSelect.Content>
								as={KSelect.Content}
								class={cx(topSlideAnimateClasses, "z-50 min-w-60")}
							>
								<MenuItemList<typeof KSelect.Listbox>
									as={KSelect.Listbox}
									class="max-h-80 overflow-y-auto"
								/>
								<p class="border-t border-ed-line px-3 py-2 text-xs text-ed-text-3">
									{localize("清晰度按短边标注，实际尺寸随画幅变化")}
								</p>
							</PopperContent>
						</KSelect.Portal>
					</KSelect>
				</div>
			</div>
			<PreviewCanvas
				onPreviewMouseDown={(event) => {
					if (event.button === 0) setPreviewPointerDown(true);
				}}
			/>
			<div
				class="flex overflow-x-auto relative z-10 flex-none flex-row gap-3 items-center px-3.5"
				style={{ height: `${48 - 4 * (props.compactness ?? 0)}px` }}
			>
				<div class="flex flex-1 items-center min-w-fit whitespace-nowrap">
					<Time
						class="font-medium text-ed-text-1"
						seconds={Math.max(
							editorState.previewTime ?? editorState.playbackTime,
							0,
						)}
					/>
					<span class="text-[13px] tabular-nums text-ed-text-3"> / </span>
					<Time seconds={totalDuration()} />
				</div>
				<div class="flex flex-row flex-none gap-3.5 items-center">
					<button
						type="button"
						class="text-ed-text-2 transition-opacity hover:opacity-70 will-change-[opacity]"
						onClick={async () => {
							const pending = requestHandoffPlayback(false, 0);
							if (pending) {
								editorState.timeline.transform.setPosition(0);
								await pending;
								return;
							}
							await commands.stopPlayback();
							setEditorState("playing", false);
							setEditorState("playbackTime", 0);
							editorState.timeline.transform.setPosition(0);
						}}
					>
						<IconCapPrev class="size-3.5" />
					</button>
					<Tooltip kbd={["Space"]} content={localize("Play/Pause video")}>
						<button
							type="button"
							onClick={handlePlayPauseClick}
							aria-label={localize("Play/Pause video")}
							aria-pressed={playbackIntent() && !isAtEnd()}
							class="flex justify-center items-center rounded-full transition-opacity size-8 bg-ed-text-1 text-ed-card hover:opacity-90"
						>
							{!playbackIntent() || isAtEnd() ? (
								<IconCapPlay class="size-3" />
							) : (
								<IconCapPause class="size-3" />
							)}
						</button>
					</Tooltip>
					<button
						type="button"
						class="text-ed-text-2 transition-opacity hover:opacity-70 will-change-[opacity]"
						onClick={async () => {
							const pending = requestHandoffPlayback(false, totalDuration());
							if (pending) {
								await pending;
								return;
							}
							await commands.stopPlayback();
							setEditorState("playing", false);
							setEditorState("playbackTime", totalDuration());
						}}
					>
						<IconCapNext class="size-3.5" />
					</button>
				</div>
				<div class="flex flex-row flex-1 gap-0.5 justify-end items-center min-w-fit">
					<EditorButton<typeof KToggleButton>
						tooltipText={localize("Toggle Split")}
						kbd={["S"]}
						pressed={editorState.timeline.interactMode === "split"}
						onChange={(v: boolean) =>
							setEditorState("timeline", "interactMode", v ? "split" : "seek")
						}
						as={KToggleButton}
						variant="danger"
						leftIcon={<IconCapScissors />}
					/>
					<div class="mx-1.5 w-px h-4 shrink-0 bg-ed-line-strong" />
					<div class="flex flex-row gap-0.5 items-center" title={zoomHint()}>
						<EditorButton
							tooltipText={localize("Zoom out")}
							kbd={["meta", "-"]}
							onClick={() => {
								editorState.timeline.transform.updateZoom(
									editorState.timeline.transform.zoom * 1.1,
									editorState.playbackTime,
								);
							}}
							leftIcon={<IconCapZoomOut />}
						/>
						<Slider
							class="w-18 shrink-0"
							thumbClass="size-3! -top-[4.5px]!"
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
							tooltipText={localize("Zoom in")}
							kbd={["meta", "+"]}
							onClick={() => {
								editorState.timeline.transform.updateZoom(
									editorState.timeline.transform.zoom / 1.1,
									editorState.playbackTime,
								);
							}}
							leftIcon={<IconCapZoomIn />}
						/>
					</div>
				</div>
			</div>
		</div>
	);
}

// CSS for checkerboard grid (adaptive to light/dark mode)
const gridStyle = {
	"background-image":
		"linear-gradient(45deg, rgba(128,128,128,0.12) 25%, transparent 25%), " +
		"linear-gradient(-45deg, rgba(128,128,128,0.12) 25%, transparent 25%), " +
		"linear-gradient(45deg, transparent 75%, rgba(128,128,128,0.12) 75%), " +
		"linear-gradient(-45deg, transparent 75%, rgba(128,128,128,0.12) 75%)",
	"background-size": "40px 40px",
	"background-position": "0 0, 0 20px, 20px -20px, -20px 0px",
	"background-color": "rgba(200,200,200,0.08)",
};

function PreviewCanvas(props: {
	onPreviewMouseDown: (event: MouseEvent) => void;
}) {
	const preparing = usePreparingEditor();
	const {
		latestFrame,
		canvasControls,
		performanceMode,
		setPerformanceMode,
		editorState,
	} = useEditorContext();

	const hasRenderedFrame = () => canvasControls()?.hasRenderedFrame() ?? false;
	createEffect(
		on(
			() => editorState.playing,
			(playing) => {
				preparing?.setOrdinaryAdvancing(
					playing,
					Math.max(Math.floor(editorState.playbackTime * FPS), 0),
				);
			},
		),
	);

	const handleContextMenu = async (e: MouseEvent) => {
		e.preventDefault();
		const menu = await Menu.new({
			items: [
				{
					id: "performance-mode",
					text: performanceMode()
						? localize("✓ 性能模式")
						: localize("性能模式"),
					action: () => setPerformanceMode(!performanceMode()),
				},
			],
		});
		menu.popup();
	};

	let initializedCanvas: HTMLCanvasElement | undefined;
	const [canvasRef, setCanvasRef] = createSignal<HTMLCanvasElement | null>(
		null,
	);

	const [canvasContainerRef, setCanvasContainerRef] =
		createSignal<HTMLDivElement>();
	createEventListener(
		canvasContainerRef,
		"mousedown",
		props.onPreviewMouseDown,
		{
			capture: true,
		},
	);
	const containerBounds = createElementBounds(canvasContainerRef);

	const [debouncedBounds, setDebouncedBounds] = createSignal({
		width: 0,
		height: 0,
	});

	const updateDebouncedBounds = debounce(
		(width: number, height: number) => setDebouncedBounds({ width, height }),
		100,
	);

	const boundsUpdater = createPreviewBoundsUpdater({
		current: () => untrack(debouncedBounds),
		measure: () => {
			const container = canvasContainerRef();
			if (!container?.isConnected) return;
			const { width, height } = container.getBoundingClientRect();
			return { width, height, connected: container.isConnected };
		},
		commit: setDebouncedBounds,
		defer: ({ width, height }) => updateDebouncedBounds(width, height),
		cancel: updateDebouncedBounds.clear,
		requestFrame: (callback) => requestAnimationFrame(callback),
		cancelFrame: (id) => cancelAnimationFrame(id),
	});

	// Only track container-size and frame-availability changes. Reading debouncedBounds()
	// reactively here would resubscribe the effect to its own debounced write:
	// the trailing setter rewrites debouncedBounds with a fresh object every
	// 100ms, which would re-run this effect and re-arm the timer forever,
	// spinning the whole preview graph at ~10Hz while the editor sits idle.
	const hasFrame = createPreviewBoundsReaction({
		bounds: () => ({
			width: containerBounds.width ?? 0,
			height: containerBounds.height ?? 0,
		}),
		hasFrame: () => !!latestFrame(),
		updater: boundsUpdater,
	});

	createEffect(() => {
		const canvas = canvasRef();
		const controls = canvasControls();
		console.warn("[Player] Canvas init effect", {
			hasCanvas: !!canvas,
			hasControls: !!controls,
			alreadyInit: initializedCanvas === canvas,
		});
		if (!canvas || !controls || initializedCanvas === canvas) return;

		console.warn("[Player] Initializing canvas", {
			canvasId: canvas.id,
			isConnected: canvas.isConnected,
		});
		controls.initDirectCanvas(canvas);
		initializedCanvas = canvas;
		console.warn("[Player] Canvas initialized successfully");
	});

	const padding = 16;
	const frameWidth = () => latestFrame()?.width ?? 1920;
	const frameHeight = () => latestFrame()?.height ?? 1080;

	const availableWidth = () =>
		Math.max(debouncedBounds().width - padding * 2, 0);
	const availableHeight = () =>
		Math.max(debouncedBounds().height - padding * 2, 0);

	const containerAspect = () => {
		const width = availableWidth();
		const height = availableHeight();
		if (width === 0 || height === 0) return 1;
		return width / height;
	};

	const frameAspect = () => {
		const width = frameWidth();
		const height = frameHeight();
		if (width === 0 || height === 0) return containerAspect();
		return width / height;
	};

	const size = () => {
		let width: number;
		let height: number;
		if (frameAspect() < containerAspect()) {
			height = availableHeight();
			width = height * frameAspect();
		} else {
			width = availableWidth();
			height = width / frameAspect();
		}

		return { width, height };
	};

	createEffect(() => {
		const frame = latestFrame();
		if (frame && hasRenderedFrame()) {
			preparing?.acknowledgeOrdinaryFrame(frame, size());
		}
	});

	return (
		<div
			ref={setCanvasContainerRef}
			class="relative flex-1 justify-center items-center min-h-0 bg-ed-card"
			style={{ contain: "layout style" }}
			onContextMenu={handleContextMenu}
		>
			<CaptionsRegenerateBadge class="absolute top-3 right-3 z-20" />
			<Show when={preparing?.model.rendered() && !preparing?.ordinaryReady()}>
				<div class="absolute inset-0 flex items-center justify-center p-4 z-10 pointer-events-none">
					<PreparingFrame fallback={false} />
				</div>
			</Show>
			<div
				class="flex overflow-hidden absolute inset-0 justify-center items-center h-full transition-opacity duration-300 ease-out motion-reduce:transition-none"
				style={{
					visibility: hasFrame() ? "visible" : "hidden",
					opacity: preparing?.model.rendered() || hasRenderedFrame() ? 1 : 0,
				}}
			>
				<div
					class="relative"
					style={{
						width: `${size().width}px`,
						height: `${size().height}px`,
						contain: "strict",
					}}
				>
					<Show when={canvasControls()} keyed>
						{(_controls) => (
							<canvas
								class="rounded-md shadow-[0_12px_32px_-8px_rgba(0,0,0,0.35),0_0_0_0.5px_rgba(0,0,0,0.12)]"
								style={{
									width: `${size().width}px`,
									height: `${size().height}px`,
									"image-rendering": "auto",
									"background-color": "#000000",
									...(hasRenderedFrame() ? gridStyle : {}),
								}}
								ref={setCanvasRef}
								id="canvas"
							/>
						)}
					</Show>
					<Show when={hasFrame()}>
						<CanvasElementsOverlay size={size()} />
						<div class="absolute inset-0 isolate pointer-events-none">
							<MaskOverlay size={size()} />
							<ImageOverlay size={size()} />
							<TextOverlay size={size()} />
						</div>
						<CaptionOverlay size={size()} />
						<SplitScreenOverlay size={size()} />
						<SnapGuidesOverlay size={size()} />
						<PerformanceOverlay size={size()} />
					</Show>
				</div>
			</div>
		</div>
	);
}

function Time(props: { seconds: number; fps?: number; class?: string }) {
	return (
		<span class={cx("text-[13px] tabular-nums text-ed-text-3", props.class)}>
			{formatTime(props.seconds, props.fps ?? FPS)}
		</span>
	);
}
