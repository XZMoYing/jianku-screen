import { Button } from "@cap/ui-solid";
import { Tabs as KTabs } from "@kobalte/core/tabs";
import { convertFileSrc } from "@tauri-apps/api/core";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { Menu, MenuItem } from "@tauri-apps/api/menu";
import { appDataDir, join } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { type as ostype } from "@tauri-apps/plugin-os";
import { cx } from "cva";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import { Portal } from "solid-js/web";
import toast from "solid-toast";
import { MotionGroup } from "~/components/InterfaceMotion";
import { t as localize } from "~/utils/i18n";
import { commands } from "~/utils/tauri";
import { type EditorTimelineSegment, useEditorContext } from "./context";
import {
	createEditorContextMenu,
	isContextMenuKey,
} from "./editor-context-menu";
import { getExistingRecordingPickerOptions } from "./existing-recording-picker";
import { routeEditorPlaybackIntent } from "./playback-intent-routing";
import { createTimelineMouseDrag } from "./Timeline/mouse-drag";
import { useEditorShortcuts } from "./useEditorShortcuts";

const formatClipDuration = (seconds: number) => {
	if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
	const total = Math.round(seconds);
	const mins = Math.floor(total / 60);
	const secs = total % 60;
	return `${mins}:${secs.toString().padStart(2, "0")}`;
};

const thumbnailCache = new Map<string, string>();
const thumbnailInflight = new Map<string, Promise<string | null>>();
const thumbnailQueue: (() => void)[] = [];
let activeThumbnailLoads = 0;
let thumbnailPumpScheduled = false;

const MAX_THUMBNAIL_LOADS = 2;

const clipThumbnailKey = (
	projectPath: string,
	recordingSegment: number,
	start: number,
) => `${projectPath}::${recordingSegment}-${Math.round(start * 1000)}`;

const scheduleThumbnailWork = (callback: () => void) => {
	const requestIdle = (
		window as Window & {
			requestIdleCallback?: (
				callback: () => void,
				options?: { timeout: number },
			) => number;
		}
	).requestIdleCallback;

	if (requestIdle) {
		requestIdle(callback, { timeout: 150 });
	} else {
		requestAnimationFrame(callback);
	}
};

const pumpThumbnailQueue = () => {
	if (thumbnailPumpScheduled) return;
	thumbnailPumpScheduled = true;

	scheduleThumbnailWork(() => {
		thumbnailPumpScheduled = false;

		while (
			activeThumbnailLoads < MAX_THUMBNAIL_LOADS &&
			thumbnailQueue.length > 0
		) {
			const run = thumbnailQueue.shift();
			if (!run) return;
			activeThumbnailLoads += 1;
			run();
		}
	});
};

const loadClipThumbnail = (
	recordingSegment: number,
	start: number,
	key: string,
) => {
	let promise = thumbnailInflight.get(key);
	if (promise) return promise;

	promise = new Promise<string | null>((resolve) => {
		thumbnailQueue.push(() => {
			commands
				.getClipThumbnail(recordingSegment, start)
				.then((path) => {
					const url = convertFileSrc(path);
					thumbnailCache.set(key, url);
					resolve(url);
				})
				.catch((error) => {
					console.error("Failed to load clip thumbnail", error);
					resolve(null);
				})
				.finally(() => {
					activeThumbnailLoads -= 1;
					thumbnailInflight.delete(key);
					pumpThumbnailQueue();
				});
		});
		pumpThumbnailQueue();
	});
	thumbnailInflight.set(key, promise);

	return promise;
};

function ClipThumbnail(props: {
	projectPath: string;
	recordingSegment: number;
	start: number;
	index: number;
}) {
	const [src, setSrc] = createSignal<string | null>(null);
	const [loaded, setLoaded] = createSignal(false);
	const [visible, setVisible] = createSignal(false);
	let container: HTMLDivElement | undefined;
	let disposed = false;

	const cacheKey = createMemo(() =>
		clipThumbnailKey(props.projectPath, props.recordingSegment, props.start),
	);

	const applySrc = (key: string, url: string | null) => {
		if (disposed || key !== cacheKey() || !url) return;
		setSrc(url);
	};

	const load = (key: string, recordingSegment: number, start: number) => {
		const cached = thumbnailCache.get(key);
		if (cached) {
			applySrc(key, cached);
			return;
		}

		const promise = loadClipThumbnail(recordingSegment, start, key);
		void promise.then((url) => applySrc(key, url));
	};

	onMount(() => {
		if (!container) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
			},
			{ rootMargin: "300px" },
		);
		observer.observe(container);
		onCleanup(() => observer.disconnect());
	});

	createEffect(() => {
		const key = cacheKey();
		const cached = thumbnailCache.get(key);
		if (cached) {
			setSrc(cached);
			return;
		}
		setSrc(null);
		setLoaded(false);
		if (visible()) load(key, props.recordingSegment, props.start);
	});

	onCleanup(() => {
		disposed = true;
	});

	return (
		<div ref={container} class="absolute inset-0">
			<div class="flex absolute inset-0 justify-center items-center bg-gray-3 dark:bg-gray-4">
				<span class="text-sm font-semibold tabular-nums text-gray-9">
					{props.index + 1}
				</span>
			</div>
			<Show when={src()}>
				{(url) => (
					<img
						src={url()}
						alt=""
						draggable={false}
						loading="lazy"
						decoding="async"
						onLoad={() => setLoaded(true)}
						class={cx(
							"absolute inset-0 object-cover pointer-events-none size-full transition-opacity duration-200",
							loaded() ? "opacity-100" : "opacity-0",
						)}
					/>
				)}
			</Show>
		</div>
	);
}

export function ClipsSidebar(props: { class?: string; active?: boolean }) {
	const {
		project,
		flushProjectConfig,
		projectActions,
		editorInstance,
		editorState,
		setEditorState,
		setDialog,
		requestHandoffPlayback,
		keymap,
	} = useEditorContext();

	const backToEditor = () => setDialog((d) => ({ ...d, open: false }));

	const [tab, setTab] = createSignal("sources");
	const sourceMenu = createEditorContextMenu();
	const [selectedSource, setSelectedSource] = createSignal<number>();
	let sourceList: HTMLDivElement | undefined;
	const [importing, setImporting] = createSignal(false);
	const [openingRecorder, setOpeningRecorder] = createSignal(false);

	const pauseForProjectChange = () =>
		routeEditorPlaybackIntent(
			requestHandoffPlayback,
			{ playing: false },
			async () => {
				if (editorState.playing) {
					await commands.stopPlayback();
					setEditorState("playing", false);
				}
			},
		);

	const recordNewClip = async () => {
		if (openingRecorder() || importing()) return;
		setOpeningRecorder(true);
		try {
			if (!(await pauseForProjectChange())) return;
			await flushProjectConfig();
			await commands.openEditorRecordingMain(editorInstance.path);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			toast.error(localize("无法打开录制窗口。{message}", { message }));
		} finally {
			setOpeningRecorder(false);
		}
	};

	const importRecordingPath = async (sourcePath: string) => {
		if (importing()) return;
		setImporting(true);
		const toastId = toast.loading(localize("Importing clip…"));
		try {
			if (!(await pauseForProjectChange())) {
				toast.dismiss(toastId);
				setImporting(false);
				return;
			}
			await flushProjectConfig();
			const count = await commands.addExistingRecordingToEditor(sourcePath);
			toast.success(
				count === 1
					? localize("Clip imported")
					: localize("{count} clips imported", { count }),
				{ id: toastId },
			);
			window.location.reload();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			toast.error(localize("导入片段失败。{message}", { message }), {
				id: toastId,
			});
			setImporting(false);
		}
	};

	const pickMp4 = async () => {
		const path = await open({
			filters: [{ name: localize("MP4 视频"), extensions: ["mp4"] }],
			multiple: false,
		});
		if (typeof path === "string") await importRecordingPath(path);
	};

	const pickExistingRecording = async () => {
		const recordingsPath = await join(await appDataDir(), "recordings");
		const path = await open(
			getExistingRecordingPickerOptions(ostype(), recordingsPath),
		);
		if (typeof path === "string") await importRecordingPath(path);
	};

	const openImportMenu = async (event: MouseEvent) => {
		if (importing()) return;
		const menu = await Menu.new({
			items: [
				await MenuItem.new({
					text: localize("导入录制工程"),
					action: () => void pickExistingRecording(),
				}),
				await MenuItem.new({
					text: localize("导入 MP4 视频…"),
					action: () => void pickMp4(),
				}),
			],
		});
		menu.popup(new LogicalPosition(event.clientX, event.clientY));
	};

	const segments = createMemo<EditorTimelineSegment[]>(
		() => project.timeline?.segments ?? [],
	);
	const sources = () => editorInstance.recordings.segments;
	const sourceLabel = (index: number) =>
		localize("素材 {number}", { number: index + 1 });
	const clipLabel = (index: number) =>
		localize("片段 {number}", { number: index + 1 });
	const displayName = (segment: EditorTimelineSegment, index: number) =>
		segment.name?.trim() || clipLabel(index);
	const displayNameAt = (index: number) => {
		const segment = segments()[index];
		return segment ? displayName(segment, index) : clipLabel(index);
	};
	const selectClip = (id: string) => {
		const index = segments().findIndex((segment) => segment.id === id);
		if (index >= 0)
			setEditorState("timeline", "selection", {
				type: "clip",
				indices: [index],
			});
	};
	const canAppendSource = (index: number) => {
		const duration = sources()[index]?.display.duration ?? 0;
		return (
			!importing() &&
			!openingRecorder() &&
			Number.isFinite(duration) &&
			duration > 0
		);
	};
	const appendSource = (index: number) => {
		if (!canAppendSource(index)) return false;
		if (projectActions.appendClipFromSource(index)) {
			setTab("clips");
			return;
		}
		toast.error(localize("素材时长不可用，无法添加"));
	};
	const showSourceMenu = (event: MouseEvent | KeyboardEvent, index: number) => {
		const uses = () =>
			segments().flatMap((clip, clipIndex) =>
				(clip.recordingSegment ?? 0) === index ? [clipIndex] : [],
			);
		sourceMenu.show(event, sourceLabel(index), [
			{
				label: localize("添加到时间线末尾"),
				shortcut: keymap.label("append"),
				disabled: !canAppendSource(index),
				run: () => appendSource(index),
			},
			{
				label: localize("选中使用此素材的片段"),
				disabled: uses().length === 0,
				run: () => {
					const indices = uses();
					if (!indices.length) return;
					setEditorState("timeline", "selection", { type: "clip", indices });
					setTab("clips");
				},
			},
		]);
	};

	useEditorShortcuts(keymap, {
		append: () => {
			const index = selectedSource();
			if (
				props.active === false ||
				tab() !== "sources" ||
				index === undefined ||
				!sourceList?.contains(document.activeElement) ||
				document.activeElement
					?.closest("[data-source-asset]")
					?.getAttribute("data-source-asset") !== String(index)
			)
				return false;
			return appendSource(index);
		},
	});

	const [editingClipId, setEditingClipId] = createSignal<string | null>(null);
	const editingIndex = createMemo(() => {
		const index = segments().findIndex(
			(segment) => segment.id === editingClipId(),
		);
		return index < 0 ? null : index;
	});
	const [draftName, setDraftName] = createSignal("");
	const startRename = (index: number, currentName: string) => {
		setDraftName(currentName);
		setEditingClipId(segments()[index]?.id ?? null);
	};
	const commitRename = (index: number) => {
		if (editingIndex() !== index) return;
		const value = draftName().trim();
		projectActions.setClipSegmentName(index, value.length ? value : null);
		setEditingClipId(null);
	};
	const cancelRename = () => setEditingClipId(null);

	const [draggingClipId, setDraggingClipId] = createSignal<string | null>(null);
	const draggingIndex = createMemo(() => {
		const index = segments().findIndex(
			(segment) => segment.id === draggingClipId(),
		);
		return index < 0 ? null : index;
	});
	const [dropIndex, setDropIndex] = createSignal<number | null>(null);
	const [pointerPos, setPointerPos] = createSignal<{
		x: number;
		y: number;
	} | null>(null);
	let listRef: HTMLDivElement | undefined;

	const computeDropIndex = (clientY: number) => {
		if (!listRef) return segments().length;
		const cards = Array.from(
			listRef.querySelectorAll<HTMLElement>("[data-clip-card]"),
		);
		let insertion = 0;
		cards.forEach((card, i) => {
			const rect = card.getBoundingClientRect();
			if (clientY > rect.top + rect.height / 2) insertion = i + 1;
		});
		return insertion;
	};

	const startGesture = createTimelineMouseDrag();
	const clearClipDrag = () => {
		setDraggingClipId(null);
		setDropIndex(null);
		setPointerPos(null);
	};
	const startClipDrag = (index: number, downEvent: MouseEvent) => {
		if (downEvent.button !== 0) return;
		const target = downEvent.target as HTMLElement;
		if (target.closest("[data-clip-delete], [data-clip-edit], [data-no-drag]"))
			return;
		const id = segments()[index]?.id;
		if (!id) return;
		downEvent.preventDefault();
		const startX = downEvent.clientX;
		const startY = downEvent.clientY;
		let active = false;
		startGesture(() => ({
			isValid: () =>
				props.active !== false &&
				tab() === "clips" &&
				segments().some((segment) => segment.id === id),
			update(event) {
				if (!active) {
					if (Math.hypot(event.clientX - startX, event.clientY - startY) < 5)
						return;
					active = true;
					setDraggingClipId(id);
				}
				setPointerPos({ x: event.clientX, y: event.clientY });
				setDropIndex(computeDropIndex(event.clientY));
			},
			finish(event, reason) {
				const bounds = listRef?.parentElement?.getBoundingClientRect();
				const releasedInside =
					event &&
					bounds &&
					event.clientX >= bounds.left &&
					event.clientX <= bounds.right &&
					event.clientY >= bounds.top &&
					event.clientY <= bounds.bottom;
				const insertion = event ? computeDropIndex(event.clientY) : null;
				clearClipDrag();
				if (reason !== "release" || !releasedInside) return;
				if (active && insertion !== null)
					projectActions.moveClipSegment(id, insertion);
				else if (!active) selectClip(id);
			},
		}));
	};

	const deleteClip = (index: number) => {
		if (segments().length < 2) return;
		projectActions.deleteClipSegment(index);
	};

	return (
		<div
			class={cx(
				"jk-editor-card flex overflow-hidden flex-col flex-1 min-w-0 min-h-0 rounded-xl bg-ed-card shadow-ed-card",
				props.class,
			)}
		>
			<button
				type="button"
				onClick={backToEditor}
				class="flex flex-none gap-2 items-center px-4 w-full h-[46px] text-[13px] font-medium border-b transition-colors text-ed-text-1 border-ed-line hover:bg-ed-ctl"
			>
				<IconCapMoveLeft class="size-4 text-ed-text-2" />
				{localize("收起素材区")}
			</button>

			<KTabs
				value={tab()}
				onChange={setTab}
				class="flex flex-col flex-1 gap-3 p-3 min-h-0"
			>
				<div class="flex flex-none flex-wrap gap-2">
					<Button
						variant="blue"
						class="flex flex-1 min-w-0 gap-2 justify-center items-center h-10"
						disabled={openingRecorder() || importing()}
						onClick={() => void recordNewClip()}
					>
						<IconLucideVideo class="size-4" />
						<span class="truncate">{localize("Record a new clip")}</span>
					</Button>
					<Button
						variant="gray"
						class="flex gap-2 justify-center items-center h-10"
						disabled={importing()}
						onClick={openImportMenu}
					>
						<IconCapCirclePlus class="size-4" />
						{localize("Import")}
					</Button>
				</div>

				<KTabs.List class="shrink-0">
					<MotionGroup
						class="flex gap-1 rounded-xl bg-ed-ctl p-1"
						label={localize("素材与片段")}
					>
						<KTabs.Trigger
							value="sources"
							class="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-xs text-ed-text-2"
						>
							{localize("来源素材")}{" "}
							<span class="tabular-nums">{sources().length}</span>
						</KTabs.Trigger>
						<KTabs.Trigger
							value="clips"
							class="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-xs text-ed-text-2"
						>
							{localize("时间线片段")}{" "}
							<span class="tabular-nums">{segments().length}</span>
						</KTabs.Trigger>
					</MotionGroup>
				</KTabs.List>

				<KTabs.Content
					ref={sourceList}
					value="sources"
					class="custom-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto"
				>
					<Show
						when={sources().length}
						fallback={
							<p class="px-2 py-6 text-center text-xs text-ed-text-3">
								{localize("暂无来源素材")}
							</p>
						}
					>
						<For each={sources()}>
							{(source, index) => (
								<div
									data-source-asset={index()}
									onContextMenu={(event) => showSourceMenu(event, index())}
									class={cx(
										"flex min-w-0 items-center gap-2 rounded-xl border p-2 transition-colors",
										selectedSource() === index()
											? "border-ed-accent bg-ed-ctl"
											: "border-ed-line bg-ed-card-2",
									)}
								>
									<button
										type="button"
										aria-pressed={selectedSource() === index()}
										onKeyDown={(event) => {
											if (isContextMenuKey(event))
												showSourceMenu(event, index());
										}}
										onClick={(event) => {
											setSelectedSource(index());
											event.currentTarget.focus();
										}}
										class="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:outline-ed-accent"
									>
										<div class="relative aspect-video w-16 shrink-0 overflow-hidden rounded-md">
											<ClipThumbnail
												projectPath={editorInstance.path}
												recordingSegment={index()}
												start={0}
												index={index()}
											/>
										</div>
										<div class="min-w-0 flex-1">
											<div class="truncate text-xs font-medium">
												{sourceLabel(index())}
											</div>
											<div class="text-[11px] tabular-nums text-ed-text-3">
												{formatClipDuration(source.display.duration)}
											</div>
										</div>
									</button>
									<button
										type="button"
										class="flex size-8 shrink-0 items-center justify-center rounded-full bg-ed-ctl text-ed-accent hover:bg-ed-ctl-hover disabled:opacity-50"
										aria-label={localize("将素材 {number} 添加到末尾", {
											number: index() + 1,
										})}
										title={
											selectedSource() === index() && keymap.label("append")
												? `${localize("添加到时间线末尾")} · ${keymap.label("append")}`
												: localize("添加到时间线末尾")
										}
										disabled={!canAppendSource(index())}
										onClick={() => appendSource(index())}
									>
										<IconCapCirclePlus class="size-4" />
									</button>
								</div>
							)}
						</For>
					</Show>
				</KTabs.Content>

				<sourceMenu.Content />
				<KTabs.Content
					value="clips"
					class="overflow-y-auto flex-1 -mx-1 px-1 min-h-0 custom-scroll"
				>
					<Show
						when={segments().length > 0}
						fallback={
							<div class="flex flex-col gap-2 justify-center items-center px-4 py-12 text-center">
								<div class="flex justify-center items-center rounded-full size-10 bg-gray-3 text-gray-9">
									<IconCapClapperboard class="size-5" />
								</div>
								<p class="text-sm font-medium text-gray-12">
									{localize("No clips yet")}
								</p>
								<p class="max-w-[200px] text-xs text-gray-10">
									{localize("可从来源素材添加片段，也可以录制或导入视频。")}
								</p>
							</div>
						}
					>
						<div ref={listRef} class="flex flex-col gap-2">
							<For each={segments()}>
								{(segment, index) => {
									const duration = () =>
										(segment.end - segment.start) / segment.timescale;
									const isDragging = () => draggingIndex() === index();
									const isSelected = () => {
										const selection = editorState.timeline?.selection;
										return (
											selection?.type === "clip" &&
											selection.indices.includes(index())
										);
									};
									const showTopBar = () =>
										draggingIndex() !== null && dropIndex() === index();
									const showBottomBar = () =>
										draggingIndex() !== null &&
										index() === segments().length - 1 &&
										dropIndex() === segments().length;

									return (
										<div class="relative">
											<Show when={showTopBar()}>
												<div class="absolute right-0 -top-1 left-0 z-10 h-0.5 rounded-full bg-ed-accent" />
											</Show>
											<Show when={showBottomBar()}>
												<div class="absolute right-0 -bottom-1 left-0 z-10 h-0.5 rounded-full bg-ed-accent" />
											</Show>
											<div
												data-clip-card
												data-clip-id={segment.id}
												onMouseDown={(e) => startClipDrag(index(), e)}
												class={cx(
													"group flex items-center gap-2 rounded-xl border p-2 transition-colors cursor-grab active:cursor-grabbing hover:bg-ed-ctl",
													isSelected()
														? "border-ed-accent bg-ed-ctl"
														: "border-ed-line bg-ed-card-2",
													isDragging() && "opacity-40",
												)}
											>
												<div class="overflow-hidden relative w-14 rounded-md aspect-video shrink-0 bg-ed-ctl">
													<ClipThumbnail
														projectPath={editorInstance.path}
														recordingSegment={segment.recordingSegment ?? 0}
														start={segment.start}
														index={index()}
													/>
												</div>
												<div class="flex flex-col flex-1 gap-0.5 min-w-0">
													<Show
														when={editingIndex() === index()}
														fallback={
															<button
																type="button"
																aria-pressed={isSelected()}
																onClick={(event) => {
																	if (event.detail === 0 && segment.id)
																		selectClip(segment.id);
																}}
																onDblClick={() =>
																	startRename(index(), segment.name ?? "")
																}
																class="text-left text-xs font-medium truncate text-ed-text-1"
															>
																{displayName(segment, index())}
															</button>
														}
													>
														<input
															data-no-drag
															ref={(el) => {
																requestAnimationFrame(() => {
																	el.focus();
																	el.select();
																});
															}}
															value={draftName()}
															placeholder={clipLabel(index())}
															onInput={(e) =>
																setDraftName(e.currentTarget.value)
															}
															onMouseDown={(e) => e.stopPropagation()}
															onKeyDown={(e) => {
																e.stopPropagation();
																if (e.key === "Enter") {
																	e.preventDefault();
																	commitRename(index());
																} else if (e.key === "Escape") {
																	e.preventDefault();
																	cancelRename();
																}
															}}
															onBlur={() => commitRename(index())}
															class="px-1.5 py-0.5 w-full text-sm rounded border outline-none bg-gray-1 dark:bg-gray-4 border-gray-6 text-gray-12 focus:border-blue-9"
														/>
													</Show>
													<span class="text-[11px] tabular-nums text-ed-text-3">
														{sourceLabel(segment.recordingSegment ?? 0)} ·{" "}
														{formatClipDuration(duration())}
													</span>
												</div>
												<div class="flex flex-none gap-0.5 items-center">
													<button
														type="button"
														data-clip-edit
														onClick={() =>
															startRename(index(), segment.name ?? "")
														}
														aria-label={localize("Rename clip")}
														class="flex flex-none justify-center items-center rounded-md opacity-0 transition-colors size-6 text-gray-10 hover:bg-gray-5 hover:text-gray-12 group-hover:opacity-100 focus-visible:opacity-100"
													>
														<IconCapPencil class="size-3.5" />
													</button>
													<Show when={segments().length > 1}>
														<button
															type="button"
															data-clip-delete
															onClick={() => deleteClip(index())}
															aria-label={localize("Remove clip")}
															class="flex flex-none justify-center items-center rounded-md opacity-0 transition-colors size-6 text-gray-10 hover:bg-red-3 hover:text-red-11 group-hover:opacity-100 focus-visible:opacity-100"
														>
															<IconCapTrash class="size-3.5" />
														</button>
													</Show>
												</div>
											</div>
										</div>
									);
								}}
							</For>
						</div>
					</Show>
				</KTabs.Content>
			</KTabs>

			<Show when={draggingIndex() !== null && pointerPos()}>
				{(pos) => (
					<Portal>
						<div
							class="flex fixed z-[1001] flex-col items-center px-3 py-2 rounded-lg border shadow-lg pointer-events-none bg-gray-2 dark:bg-gray-3 border-gray-6"
							style={{
								left: `${pos().x + 14}px`,
								top: `${pos().y + 14}px`,
							}}
						>
							<span class="text-sm font-medium text-gray-12">
								{displayNameAt(draggingIndex() ?? 0)}
							</span>
						</div>
					</Portal>
				)}
			</Show>
		</div>
	);
}
