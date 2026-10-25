import { Popover } from "@kobalte/core/popover";
import { createMemo, createSignal, For, Show } from "solid-js";
import { t as localize } from "~/utils/i18n";
import IconBookmark from "~icons/lucide/bookmark";
import { useEditorContext } from "../context";
import { bookmarkTimestamp } from "../recording-bookmarks";
import { type BookmarkMarker, layoutBookmarkMarkers } from "./bookmark-markers";
import { useTimelineContext } from "./context";

export function BookmarkTrack(props: { gutter: number }) {
	const { recordingBookmarks, editorState } = useEditorContext();
	const { secsPerPixel, timelineBounds } = useTimelineContext();
	const groups = createMemo(() =>
		layoutBookmarkMarkers(
			recordingBookmarks.items() ?? [],
			editorState.timeline.transform.position,
			secsPerPixel(),
			timelineBounds.width ?? 0,
		),
	);
	const title = (item: BookmarkMarker) =>
		`${bookmarkTimestamp(item.time)} · ${item.label || localize("书签 {number}", { number: item.number })}`;
	return (
		<Show when={recordingBookmarks.items()?.length}>
			<div
				class="relative h-7 shrink-0 rounded-lg bg-ed-ctl/50"
				data-testid="bookmark-track"
			>
				<div
					class="absolute inset-y-0 left-0 flex items-center gap-2 px-2 text-xs text-ed-text-2"
					style={{ width: `${props.gutter}px` }}
				>
					<IconBookmark class="size-3" />
					{localize("书签")}
				</div>
				<div
					class="absolute inset-y-0 right-0 overflow-hidden"
					style={{ left: `${props.gutter}px` }}
				>
					<For each={groups()}>
						{(group) => {
							const [open, setOpen] = createSignal(false);
							const label = () =>
								group.items.length === 1
									? title(group.items[0])
									: localize("{number} 个相邻书签", {
											number: group.items.length,
										});
							const jump = async (item: BookmarkMarker) => {
								if (await recordingBookmarks.jump(item.time)) setOpen(false);
							};
							return (
								<Popover open={open()} onOpenChange={setOpen} placement="top">
									<Popover.Trigger
										class="absolute top-1 flex h-5 min-w-5 items-center justify-center rounded-md bg-ed-accent/20 px-1 text-ed-text-1 hover:bg-ed-accent/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ed-accent"
										style={{
											left: `${group.left}px`,
											width: `${group.width}px`,
										}}
										title={label()}
										aria-label={label()}
										disabled={recordingBookmarks.busy()}
										onMouseDown={(event) => event.stopPropagation()}
										onMouseMove={(event) => event.stopPropagation()}
										onKeyDown={(event) => {
											if (event.key === "Enter" || event.key === " ")
												event.stopPropagation();
										}}
										onClick={(event) => {
											if (group.items.length === 1) {
												event.preventDefault();
												void jump(group.items[0]);
											}
										}}
									>
										<IconBookmark class="size-3" />
										<Show when={group.items.length > 1}>
											<span class="ml-0.5 text-[10px]">
												{group.items.length}
											</span>
										</Show>
									</Popover.Trigger>
									<Popover.Portal>
										<Popover.Content
											class="z-[100] max-h-64 max-w-80 overflow-y-auto rounded-2xl border border-ed-divider bg-ed-card p-2 text-ed-text-1 shadow-lg"
											onKeyDown={(event) => {
												if (event.key !== "Escape") event.stopPropagation();
											}}
										>
											<For each={group.items}>
												{(item) => (
													<button
														type="button"
														class="block w-full truncate rounded-xl px-3 py-2 text-left text-sm hover:bg-ed-ctl-hover"
														disabled={recordingBookmarks.busy()}
														onClick={() => void jump(item)}
													>
														{title(item)}
													</button>
												)}
											</For>
										</Popover.Content>
									</Popover.Portal>
								</Popover>
							);
						}}
					</For>
				</div>
			</div>
		</Show>
	);
}
