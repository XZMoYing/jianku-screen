import { createResource, createSignal, For, Show } from "solid-js";
import toast from "solid-toast";
import { t as localize } from "~/utils/i18n";
import { commands, type RecordingBookmark } from "~/utils/tauri";
import IconBookmark from "~icons/lucide/bookmark";
import IconTrash from "~icons/lucide/trash-2";
import {
	FPS,
	serializeProjectConfiguration,
	useEditorContext,
} from "./context";
import { Dialog, DialogContent, EditorButton } from "./ui";

function timestamp(seconds: number) {
	const ticks = Math.round(seconds * 10);
	return `${Math.floor(ticks / 600)}:${((ticks % 600) / 10).toFixed(1).padStart(4, "0")}`;
}

export function BookmarksButton(props: { disabled?: boolean }) {
	const {
		project,
		setEditorState,
		requestHandoffPlayback,
		dialog,
		exportState,
	} = useEditorContext();
	const [open, setOpen] = createSignal(false);
	const [busy, setBusy] = createSignal(false);
	const [bookmarks, { refetch }] = createResource(
		() => open() && serializeProjectConfiguration(project).timeline,
		(timeline) => commands.getRecordingBookmarks(timeline),
	);
	const report = (error: unknown) => toast.error(String(error));
	const save = async (bookmark: RecordingBookmark, label: string | null) => {
		if (busy()) return;
		setBusy(true);
		try {
			await commands.updateRecordingBookmark(bookmark.id, label);
			await refetch();
		} catch (error) {
			report(error);
		} finally {
			setBusy(false);
		}
	};
	const jump = async (time: number) => {
		if (busy()) return;
		setBusy(true);
		try {
			const pending = requestHandoffPlayback(false, time);
			if (pending) {
				if (!(await pending))
					throw new Error(localize("画面仍在准备，请稍后再跳转"));
			} else {
				await commands.stopPlayback();
				await commands.seekTo(Math.floor(time * FPS));
				setEditorState("playing", false);
				setEditorState("previewTime", null);
				setEditorState("playbackTime", time);
			}
			setOpen(false);
		} catch (error) {
			report(error);
		} finally {
			setBusy(false);
		}
	};
	return (
		<>
			<EditorButton
				title={localize("录制书签")}
				aria-label={localize("录制书签")}
				leftIcon={<IconBookmark />}
				disabled={
					props.disabled ||
					dialog().open ||
					!["idle", "done"].includes(exportState.type)
				}
				onClick={() => setOpen(true)}
			>
				<span class="max-[1200px]:hidden">{localize("书签")}</span>
			</EditorButton>
			<Dialog.Root open={open()} onOpenChange={setOpen} size="sm">
				<div
					onKeyDown={(event) => {
						if (event.key !== "Escape") event.stopPropagation();
					}}
				>
					<DialogContent
						title={localize("录制书签")}
						confirm={
							<Dialog.ConfirmButton onClick={() => setOpen(false)}>
								{localize("完成")}
							</Dialog.ConfirmButton>
						}
					>
						<div
							class="flex max-h-[55vh] flex-col gap-3 overflow-y-auto"
							data-testid="recording-bookmarks"
							onKeyDown={(event) => {
								if (event.key !== "Escape") event.stopPropagation();
							}}
						>
							<Show when={bookmarks.error}>
								<p role="alert">{String(bookmarks.error)}</p>
							</Show>
							<Show
								when={
									!bookmarks.loading && !bookmarks.error && !bookmarks()?.length
								}
							>
								<p class="text-ed-text-2">
									{localize(
										"录制时点击书签按钮，或使用设置中的快捷键，标记讲解重点。",
									)}
								</p>
							</Show>
							<For each={bookmarks()}>
								{(item, index) => (
									<div class="rounded-2xl bg-ed-ctl p-3 flex flex-col gap-2">
										<div class="flex items-center gap-2">
											<IconBookmark class="size-4 shrink-0" />
											<input
												class="min-w-0 flex-1 rounded-lg bg-transparent px-2 py-1 text-ed-text-1"
												aria-label={localize("书签名称")}
												maxLength={120}
												disabled={busy()}
												value={item.bookmark.label}
												placeholder={localize("书签 {number}", {
													number: index() + 1,
												})}
												onKeyDown={(event) => {
													event.stopPropagation();
													if (event.key === "Enter") event.currentTarget.blur();
												}}
												onBlur={(event) => {
													if (
														event.currentTarget.value.trim() !==
														item.bookmark.label
													)
														void save(item.bookmark, event.currentTarget.value);
												}}
											/>
											<button
												type="button"
												class="p-2"
												onPointerDown={(event) => event.preventDefault()}
												aria-label={localize("删除书签")}
												disabled={busy()}
												onClick={() => void save(item.bookmark, null)}
											>
												<IconTrash class="size-4" />
											</button>
										</div>
										<div class="flex flex-wrap gap-2">
											<For each={item.positions}>
												{(time) => (
													<button
														type="button"
														onPointerDown={(event) => event.preventDefault()}
														class="rounded-full bg-ed-ctl-hover px-3 py-1 text-sm tabular-nums"
														disabled={busy()}
														onClick={() => void jump(time)}
													>
														{timestamp(time)}
													</button>
												)}
											</For>
											<Show when={!item.positions.length}>
												<span class="text-sm text-ed-text-2">
													{localize("所在画面已被剪除")}
												</span>
											</Show>
										</div>
									</div>
								)}
							</For>
						</div>
					</DialogContent>
				</div>
			</Dialog.Root>
		</>
	);
}
