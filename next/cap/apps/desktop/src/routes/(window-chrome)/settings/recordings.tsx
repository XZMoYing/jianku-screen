import { Button, ProgressCircle } from "@cap/ui-solid";
import {
	createQuery,
	queryOptions,
	useQueryClient,
} from "@tanstack/solid-query";
import { invoke } from "@tauri-apps/api/core";
import { ask, confirm, open } from "@tauri-apps/plugin-dialog";
import { remove } from "@tauri-apps/plugin-fs";
import * as shell from "@tauri-apps/plugin-shell";
import { cx } from "cva";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { createStore, produce } from "solid-js/store";
import toast from "solid-toast";
import { MotionText } from "~/components/MotionText";
import CapTooltip from "~/components/Tooltip";
import { TooltipIconButton } from "~/components/TooltipIconButton";
import { Input } from "~/routes/editor/ui";
import { trackEvent } from "~/utils/analytics";
import { createTauriEventListener } from "~/utils/createEventListener";
import { t as localize } from "~/utils/i18n";
import { importVideoFromPicker, showImportError } from "~/utils/importMedia";
import { displayRecordingName, openRecordingFolder } from "~/utils/recording";
import { createRecordingThumbnail } from "~/utils/recording-thumbnail";
import {
	commands,
	events,
	type RecordingMetaWithMetadata,
} from "~/utils/tauri";
import IconLucideCheck from "~icons/lucide/check";
import IconLucideFolderOutput from "~icons/lucide/folder-output";
import IconLucideImport from "~icons/lucide/import";
import IconLucideSearch from "~icons/lucide/search";
import { Section, SettingsPageContent } from "./Setting";

type Recording = {
	meta: RecordingMetaWithMetadata;
	path: string;
	prettyName: string;
};

type BatchExportProjectsResult = {
	exportDir: string;
	exportedCount: number;
	failed: string[];
};

const PAGE_SIZE = 20;

const hasActiveRecording = (recording: Recording) => {
	const status = recording.meta.status.status;
	if (status === "InProgress" || status === "NeedsRemux") return true;
	const uploadState = recording.meta.upload?.state;
	return (
		uploadState === "MultipartUpload" || uploadState === "SinglePartUpload"
	);
};

const recordingsQuery = queryOptions<Recording[]>({
	queryKey: ["recordings"],
	queryFn: async () => {
		const result = await commands.listRecordings().catch(() => [] as const);

		const recordings = await Promise.all(
			result.map(async (file) => {
				const [path, meta] = file;

				return {
					meta,
					path,
					prettyName: displayRecordingName(meta.pretty_name),
				};
			}),
		);
		return recordings;
	},
	reconcile: "path",
	refetchInterval: (query) => {
		const data = query.state.data;
		if (!data) return false;
		return data.some(hasActiveRecording) ? 2000 : false;
	},
});

export default function Recordings() {
	const [search, setSearch] = createSignal("");
	const trimmedSearch = createMemo(() => search().trim());
	const normalizedSearch = createMemo(() => trimmedSearch().toLowerCase());
	const [visibleCount, setVisibleCount] = createSignal(PAGE_SIZE);
	const [selectMode, setSelectMode] = createSignal(false);
	const [selectedPaths, setSelectedPaths] = createSignal<Set<string>>(
		new Set(),
	);
	const [exporting, setExporting] = createSignal(false);
	const [uploadProgress, setUploadProgress] = createStore<
		Record</* video_id */ string, number>
	>({});
	const recordings = createQuery(() => recordingsQuery);

	createTauriEventListener(events.uploadProgressEvent, (e) => {
		if (e.uploaded === "0" && e.total === "0") {
			setUploadProgress(
				produce((s) => {
					delete s[e.video_id];
				}),
			);
		} else {
			const total = Number(e.total);
			const progress = total > 0 ? (Number(e.uploaded) / total) * 100 : 0;
			setUploadProgress(e.video_id, progress);
		}
	});

	createTauriEventListener(events.recordingDeleted, () => recordings.refetch());

	createEffect(() => {
		trimmedSearch();
		setVisibleCount(PAGE_SIZE);
	});

	const filteredRecordings = createMemo(() => {
		const data = recordings.data ?? [];
		const query = normalizedSearch();
		if (!query) return data;
		return data.filter((recording) =>
			recording.prettyName.toLowerCase().includes(query),
		);
	});

	const visibleRecordings = createMemo(() => {
		const items = filteredRecordings();
		if (normalizedSearch() || selectMode()) return items;
		return items.slice(0, visibleCount());
	});

	const hasMoreRecordings = createMemo(
		() =>
			!normalizedSearch() &&
			!selectMode() &&
			filteredRecordings().length > visibleCount(),
	);

	const emptyMessage = createMemo(() =>
		trimmedSearch() ? localize("没有匹配的录制工程") : localize("暂无录制工程"),
	);

	const allFilteredSelected = createMemo(() => {
		const items = filteredRecordings();
		if (items.length === 0) return false;
		const selected = selectedPaths();
		return items.every((item) => selected.has(item.path));
	});

	const selectedCount = createMemo(() => selectedPaths().size);

	const toggleSelection = (path: string) => {
		setSelectedPaths((prev) => {
			const next = new Set(prev);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});
	};

	const toggleSelectAll = () => {
		const items = filteredRecordings();
		if (allFilteredSelected()) {
			setSelectedPaths((prev) => {
				const next = new Set(prev);
				for (const item of items) next.delete(item.path);
				return next;
			});
		} else {
			setSelectedPaths((prev) => {
				const next = new Set(prev);
				for (const item of items) next.add(item.path);
				return next;
			});
		}
	};

	const invertSelection = () => {
		const items = filteredRecordings();
		setSelectedPaths((prev) => {
			const next = new Set(prev);
			for (const item of items) {
				if (next.has(item.path)) next.delete(item.path);
				else next.add(item.path);
			}
			return next;
		});
	};

	const exitSelectMode = () => {
		setSelectMode(false);
		setSelectedPaths(new Set<string>());
	};

	const handleBatchExport = async () => {
		const paths = Array.from(selectedPaths());
		if (paths.length === 0 || exporting()) return;

		const destination = await open({
			directory: true,
			multiple: false,
			title: localize("选择工程导出位置"),
		});
		if (!destination || typeof destination !== "string") return;

		setExporting(true);
		try {
			const result = await invoke<BatchExportProjectsResult>(
				"export_recording_projects",
				{
					projectPaths: paths,
					destinationDir: destination,
				},
			);
			if (result.failed.length > 0) {
				toast.error(
					localize("已导出 {count} 个工程，{failed} 个失败", {
						count: result.exportedCount,
						failed: result.failed.length,
					}),
				);
			} else {
				toast.success(
					localize("已将 {count} 个录制工程导出到新建文件夹", {
						count: result.exportedCount,
					}),
				);
			}
			exitSelectMode();
			await commands.openFilePath(result.exportDir).catch(() => {});
		} catch (error) {
			console.error("Failed to batch export recording projects:", error);
			toast.error(
				error instanceof Error ? error.message : localize(String(error)),
			);
		} finally {
			setExporting(false);
		}
	};

	const handleRecordingClick = (recording: Recording) => {
		trackEvent("recording_view_clicked");
		events.newStudioRecordingAdded.emit({ path: recording.path });
	};

	const handleOpenFolder = (recording: Recording) => {
		trackEvent("recording_folder_clicked");
		openRecordingFolder(recording.path, recording.meta.mode).catch((error) => {
			console.error("Failed to open recording folder:", error);
		});
	};

	const handleCopyVideoToClipboard = (path: string) => {
		trackEvent("recording_copy_clicked");
		commands.copyVideoToClipboard(path);
	};

	const handleOpenEditor = (path: string) => {
		trackEvent("recording_editor_clicked");
		commands.showWindow({
			Editor: { project_path: path },
		});
	};

	const handleVideoImport = async () => {
		try {
			await importVideoFromPicker();
		} catch (e) {
			console.error("Failed to import video:", e);
			await showImportError("video", e);
		}
	};

	return (
		<div class="cap-settings-page flex relative flex-col w-full h-full custom-scroll">
			<SettingsPageContent class="max-w-none space-y-4">
				<Section
					title={localize("Recordings")}
					description={localize("Manage your recordings and perform actions.")}
					right={
						<div class="flex items-center gap-2 shrink-0">
							<Show when={recordings.data && recordings.data.length > 0}>
								<Button
									variant={selectMode() ? "primary" : "gray"}
									size="sm"
									class="h-[36px] px-3 shrink-0 flex items-center gap-1.5"
									disabled={exporting()}
									onClick={() => {
										if (selectMode()) exitSelectMode();
										else setSelectMode(true);
									}}
								>
									<IconLucideFolderOutput class="size-3.5" />
									<span>
										{selectMode() ? localize("完成选择") : localize("导出")}
									</span>
								</Button>
							</Show>
							<Button
								variant="gray"
								size="sm"
								class="h-[36px] px-3 shrink-0 flex items-center gap-1.5"
								disabled={exporting()}
								onClick={handleVideoImport}
							>
								<IconLucideImport class="size-3.5" />
								<span>{localize("Import")}</span>
							</Button>
						</div>
					}
				>
					<Show
						when={recordings.data && recordings.data.length > 0}
						fallback={
							<p class="text-center text-(--text-tertiary) absolute flex items-center justify-center w-full h-full">
								{localize("No recordings found")}
							</p>
						}
					>
						<div class="flex flex-col gap-3 pb-4 w-full border-b border-gray-2">
							<div class="flex flex-wrap items-center justify-between gap-3">
								<div class="relative w-full max-w-[260px] h-[36px] flex items-center">
									<IconLucideSearch class="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none size-3 text-gray-10" />
									<Input
										type="search"
										class="py-2 pl-6 h-full w-full"
										value={search()}
										onInput={(event) => setSearch(event.currentTarget.value)}
										onKeyDown={(event) => {
											if (event.key === "Escape" && search()) {
												event.preventDefault();
												setSearch("");
											}
										}}
										placeholder={localize("Search")}
										autoCapitalize="off"
										autocorrect="off"
										autocomplete="off"
										spellcheck={false}
										aria-label={localize("Search recordings")}
									/>
								</div>

								<Show when={selectMode()}>
									<div class="flex flex-wrap items-center gap-2">
										<Button
											variant="gray"
											size="sm"
											disabled={
												exporting() || filteredRecordings().length === 0
											}
											onClick={toggleSelectAll}
										>
											{allFilteredSelected()
												? localize("取消全选")
												: localize("全选")}
										</Button>
										<Button
											variant="gray"
											size="sm"
											disabled={
												exporting() || filteredRecordings().length === 0
											}
											onClick={invertSelection}
										>
											{localize("反选")}
										</Button>
										<span class="text-xs text-gray-11 tabular-nums px-1">
											{localize("已选 {count} 项", {
												count: selectedCount(),
											})}
										</span>
										<Button
											variant="primary"
											size="sm"
											disabled={exporting() || selectedCount() === 0}
											onClick={() => void handleBatchExport()}
										>
											{exporting()
												? localize("正在导出…")
												: localize("导出所选 ({count})", {
														count: selectedCount(),
													})}
										</Button>
										<Button
											variant="gray"
											size="sm"
											disabled={exporting()}
											onClick={exitSelectMode}
										>
											{localize("Cancel")}
										</Button>
									</div>
								</Show>
							</div>
						</div>

						<div class="flex relative flex-col flex-1 mt-4 rounded-xl border custom-scroll bg-gray-2 border-gray-3">
							<Show when={filteredRecordings().length === 0}>
								<p class="text-center text-(--text-tertiary) absolute flex items-center justify-center w-full h-full">
									{emptyMessage()}
								</p>
							</Show>
							<ul class="flex flex-col w-full text-(--text-primary)">
								<For each={visibleRecordings()}>
									{(recording) => (
										<RecordingItem
											recording={recording}
											selectMode={selectMode()}
											selected={selectedPaths().has(recording.path)}
											onToggleSelect={() => toggleSelection(recording.path)}
											onClick={() => handleRecordingClick(recording)}
											onOpenFolder={() => handleOpenFolder(recording)}
											onOpenEditor={() => handleOpenEditor(recording.path)}
											onCopyVideoToClipboard={() =>
												handleCopyVideoToClipboard(recording.path)
											}
											uploadProgress={
												recording.meta.upload &&
												(recording.meta.upload.state === "MultipartUpload" ||
													recording.meta.upload.state === "SinglePartUpload")
													? uploadProgress[recording.meta.upload.video_id]
													: undefined
											}
										/>
									)}
								</For>
							</ul>
							<Show when={hasMoreRecordings()}>
								<div class="flex justify-center p-3 border-t border-gray-3">
									<Button
										variant="gray"
										size="sm"
										onClick={() =>
											setVisibleCount((count) =>
												Math.min(
													count + PAGE_SIZE,
													filteredRecordings().length,
												),
											)
										}
									>
										{localize("Load more")}
									</Button>
								</div>
							</Show>
						</div>
					</Show>
				</Section>
			</SettingsPageContent>
		</div>
	);
}

function RecordingItem(props: {
	recording: Recording;
	selectMode: boolean;
	selected: boolean;
	onToggleSelect: () => void;
	onClick: () => void;
	onOpenFolder: () => void;
	onOpenEditor: () => void;
	onCopyVideoToClipboard: () => void;
	uploadProgress: number | undefined;
}) {
	const [imageExists, setImageExists] = createSignal(true);
	const thumbnail = createRecordingThumbnail(() => props.recording.path);
	createEffect(() => {
		thumbnail();
		setImageExists(true);
	});
	const modeName = () => localize("录制模式");

	const queryClient = useQueryClient();
	const studioCompleteCheck = () =>
		props.recording.meta.status.status === "Complete";

	return (
		<li
			onClick={() => {
				if (props.selectMode) {
					props.onToggleSelect();
					return;
				}
				if (studioCompleteCheck()) {
					props.onOpenEditor();
				}
			}}
			class={cx(
				"flex flex-row justify-between p-3 not-last:border-b not-last:border-gray-3 items-center w-full transition-colors duration-200",
				props.selectMode
					? props.selected
						? "bg-[color-mix(in_srgb,var(--jk-primary)_10%,transparent)] cursor-pointer"
						: "hover:bg-gray-3 cursor-pointer"
					: studioCompleteCheck()
						? "hover:bg-gray-3 cursor-pointer"
						: "cursor-default",
			)}
		>
			<div class="flex gap-4 items-center min-w-0">
				<Show when={props.selectMode}>
					<span
						role="checkbox"
						aria-checked={props.selected}
						aria-label={props.recording.prettyName}
						class={cx(
							"flex items-center justify-center size-5 shrink-0 rounded-md border transition-colors",
							props.selected
								? "bg-[var(--jk-primary)] border-[var(--jk-primary)] text-white"
								: "bg-gray-1 border-gray-6",
						)}
					>
						<Show when={props.selected}>
							<IconLucideCheck class="size-3.5" />
						</Show>
					</span>
				</Show>
				<Show
					when={imageExists()}
					fallback={<div class="mr-4 rounded-sm bg-gray-10 size-11 shrink-0" />}
				>
					<img
						class="object-cover rounded-sm size-12 shrink-0"
						alt={localize("Recording thumbnail")}
						src={thumbnail()}
						onError={() => setImageExists(false)}
					/>
				</Show>
				<div class="flex flex-col gap-2 min-w-0">
					<span class="truncate">{props.recording.prettyName}</span>
					<div class="flex space-x-1">
						<div class="px-2 py-0.5 flex items-center gap-1.5 font-medium text-[11px] text-gray-12 rounded-full w-fit bg-gray-4">
							<IconCapFilmCut class="invert size-2.5 dark:invert-0" />
							<p>
								<MotionText text={modeName()} />
							</p>
						</div>

						<Show when={props.recording.meta.clip_count > 1}>
							<div class="px-2 py-0.5 flex items-center font-medium text-[11px] text-gray-12 rounded-full w-fit bg-gray-4">
								<p>
									<MotionText
										text={localize("{count} clips", {
											count: props.recording.meta.clip_count,
										})}
									/>
								</p>
							</div>
						</Show>

						<Show when={props.recording.meta.status.status === "InProgress"}>
							<div
								class={cx(
									"px-2 py-0.5 flex items-center gap-1.5 font-medium text-[11px] rounded-full w-fit bg-[var(--jk-rec)] text-white leading-none text-center",
								)}
							>
								<IconPhRecordFill class="invert size-2.5 dark:invert-0" />
								<p>{localize("Recording in progress")}</p>
							</div>
						</Show>

						<Show when={props.recording.meta.status.status === "Failed"}>
							<CapTooltip
								content={
									<span>
										{props.recording.meta.status.status === "Failed"
											? props.recording.meta.status.error
											: ""}
									</span>
								}
							>
								<div
									class={cx(
										"px-2 py-0.5 flex items-center gap-1.5 font-medium text-[11px] text-gray-12 rounded-full w-fit bg-red-9 leading-none text-center",
									)}
								>
									<IconPhWarningBold class="invert size-2.5 dark:invert-0" />
									<p>{localize("Recording failed")}</p>
								</div>
							</CapTooltip>
						</Show>
					</div>
				</div>
			</div>
			<Show when={!props.selectMode}>
				<div
					class="flex gap-2 items-center shrink-0"
					onClick={(e) => e.stopPropagation()}
				>
					<Show when={props.uploadProgress}>
						<CapTooltip content={`${(props.uploadProgress || 0).toFixed(2)}%`}>
							<ProgressCircle
								variant="primary"
								progress={props.uploadProgress || 0}
								size="sm"
							/>
						</CapTooltip>
					</Show>
					<Show when={props.recording.meta.sharing}>
						{(sharing) => (
							<TooltipIconButton
								tooltipText={localize("Open link")}
								onClick={() => shell.open(sharing().link)}
							>
								<IconCapLink class="size-4" />
							</TooltipIconButton>
						)}
					</Show>
					<TooltipIconButton
						tooltipText={localize("Edit")}
						onClick={async () => {
							if (
								props.recording.meta.status.status === "Failed" &&
								!(await confirm(
									localize(
										"录制失败，文件在编辑器中可能无法正常打开。如果无法恢复，请联系支持团队。",
									),
									{
										title: localize("录制文件可能已损坏"),
										kind: "warning",
									},
								))
							)
								return;
							props.onOpenEditor();
						}}
						disabled={props.recording.meta.status.status === "InProgress"}
					>
						<IconLucideEdit class="size-4" />
					</TooltipIconButton>
					<TooltipIconButton
						tooltipText={localize("Open recording bundle")}
						onClick={() => {
							props.onOpenFolder();
						}}
					>
						<IconLucideFolder class="size-4" />
					</TooltipIconButton>
					<TooltipIconButton
						tooltipText={localize("Delete")}
						onClick={async () => {
							if (!(await ask(localize("确定要删除这段录制吗？")))) return;
							await remove(props.recording.path, { recursive: true });

							queryClient.refetchQueries(recordingsQuery);
						}}
					>
						<IconCapTrash class="size-4" />
					</TooltipIconButton>
				</div>
			</Show>
		</li>
	);
}
