import { createMemo, Show } from "solid-js";
import { t as localize } from "~/utils/i18n";
import { ClipProperties } from "./ClipProperties";
import { useEditorContext } from "./context";
import { TextInput } from "./TextInput";

export function ClipInspector(props: { indices: number[] }) {
	const { project, projectActions, setEditorState } = useEditorContext();
	const segments = () => project.timeline?.segments ?? [];
	const selected = createMemo(() =>
		props.indices.flatMap((index) => {
			const id = segments()[index]?.id;
			return id ? [id] : [];
		}),
	);
	const singleId = () => (selected().length === 1 ? selected()[0] : undefined);

	return (
		<div class="flex flex-col gap-3">
			<div class="flex min-w-0 items-center justify-between gap-2">
				<span class="text-sm font-medium">{localize("片段属性")}</span>
				<button
					type="button"
					class="shrink-0 rounded-lg px-2 py-1 text-xs text-ed-accent hover:bg-ed-ctl"
					onClick={() => setEditorState("timeline", "selection", null)}
				>
					{localize("返回全局设置")}
				</button>
			</div>
			<Show
				when={singleId()}
				keyed
				fallback={
					<p class="text-xs leading-relaxed text-ed-text-3">
						{localize("已选择 {count} 个片段。选择单个片段以编辑属性。", {
							count: selected().length,
						})}
					</p>
				}
			>
				{(id) => {
					const index = () =>
						segments().findIndex((segment) => segment.id === id);
					return (
						<Show when={segments()[index()]}>
							{(segment) => (
								<>
									<label class="flex flex-col gap-1.5 text-xs text-ed-text-2">
										{localize("Clip name")}
										<TextInput
											class="h-8 px-2"
											value={segment().name ?? ""}
											placeholder={localize("片段 {number}", {
												number: index() + 1,
											})}
											onChange={(event) => {
												if (index() >= 0)
													projectActions.setClipSegmentName(
														index(),
														event.currentTarget.value,
													);
											}}
											onKeyDown={(event) => {
												if (event.key === "Escape")
													event.currentTarget.value = segment().name ?? "";
												if (event.key === "Enter" || event.key === "Escape")
													event.currentTarget.blur();
											}}
										/>
									</label>
									<p class="text-xs text-ed-text-3">
										{localize("来源素材")} ·{" "}
										{localize("素材 {number}", {
											number: (segment().recordingSegment ?? 0) + 1,
										})}
									</p>
									<ClipProperties index={index()} segment={segment()} />
								</>
							)}
						</Show>
					);
				}}
			</Show>
		</div>
	);
}
