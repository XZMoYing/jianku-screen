import { Tabs } from "@kobalte/core/tabs";
import { createMemo, createSignal, createUniqueId, For, Show } from "solid-js";
import { MotionGroup, MotionSwitch } from "~/components/InterfaceMotion";
import { t as localize } from "~/utils/i18n";
import type { TimelineSegment } from "~/utils/tauri";
import { ClipProperties } from "./ClipProperties";
import { clipDuration } from "./clip-transitions";
import { useEditorContext } from "./context";
import { TextInput } from "./TextInput";
import { formatTime } from "./utils";

const sections = [
	{ id: "basic", label: "基础" },
	{ id: "speed", label: "变速" },
	{ id: "audio", label: "音频" },
	{ id: "cursor", label: "光标" },
] as const;
type Section = (typeof sections)[number]["id"];

export function ClipInspector(props: { indices: number[] }) {
	const { project, setEditorState } = useEditorContext();
	const segments = () => project.timeline?.segments ?? [];
	const selected = createMemo(() =>
		props.indices.flatMap((index) => {
			const id = segments()[index]?.id;
			return id ? [id] : [];
		}),
	);
	const singleId = () => (selected().length === 1 ? selected()[0] : undefined);
	const [section, setSection] = createSignal<Section>("basic");
	const tabsId = createUniqueId();

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
								<Tabs
									value={section()}
									onChange={(value) => setSection(value as Section)}
								>
									<Tabs.List>
										<MotionGroup
											class="flex gap-1 rounded-xl bg-ed-ctl p-1"
											label={localize("片段属性")}
										>
											<For each={sections}>
												{(item) => (
													<Tabs.Trigger
														value={item.id}
														id={`${tabsId}-tab-${item.id}`}
														aria-controls={`${tabsId}-panel-${item.id}`}
														class="min-w-0 flex-1 rounded-lg px-1 py-1.5 text-xs text-ed-text-2"
													>
														{localize(item.label)}
													</Tabs.Trigger>
												)}
											</For>
										</MotionGroup>
									</Tabs.List>
									<MotionSwitch value={section()} kind="subpage">
										{(active) => {
											const properties = () => {
												const value = active();
												return value === "basic" ? null : value;
											};
											return (
												<div
													role="tabpanel"
													id={`${tabsId}-panel-${active()}`}
													aria-labelledby={`${tabsId}-tab-${active()}`}
													class="pt-3"
												>
													<Show
														when={properties()}
														fallback={
															<ClipBasics index={index()} segment={segment()} />
														}
													>
														{(value) => (
															<ClipProperties
																index={index()}
																segment={segment()}
																section={value()}
															/>
														)}
													</Show>
												</div>
											);
										}}
									</MotionSwitch>
								</Tabs>
							)}
						</Show>
					);
				}}
			</Show>
		</div>
	);
}

function ClipBasics(props: { index: number; segment: TimelineSegment }) {
	const { projectActions } = useEditorContext();
	const fields = [
		{ label: "素材入点", value: () => props.segment.start },
		{ label: "素材出点", value: () => props.segment.end },
		{ label: "时长", value: () => clipDuration(props.segment) },
	];
	return (
		<div class="flex flex-col gap-3">
			<label class="flex flex-col gap-1.5 text-xs text-ed-text-2">
				{localize("Clip name")}
				<TextInput
					class="h-8 px-2"
					value={props.segment.name ?? ""}
					placeholder={localize("片段 {number}", { number: props.index + 1 })}
					onChange={(event) =>
						projectActions.setClipSegmentName(
							props.index,
							event.currentTarget.value,
						)
					}
					onKeyDown={(event) => {
						if (event.key === "Escape")
							event.currentTarget.value = props.segment.name ?? "";
						if (event.key === "Enter" || event.key === "Escape")
							event.currentTarget.blur();
					}}
				/>
			</label>
			<p class="text-xs text-ed-text-3">
				{localize("来源素材")} ·{" "}
				{localize("素材 {number}", {
					number: (props.segment.recordingSegment ?? 0) + 1,
				})}
			</p>
			<dl class="grid grid-cols-3 gap-2 rounded-xl bg-ed-ctl p-2 text-xs">
				<For each={fields}>
					{(field) => (
						<div class="min-w-0">
							<dt class="text-ed-text-3">{localize(field.label)}</dt>
							<dd class="mt-1 truncate tabular-nums text-ed-text-1">
								{formatTime(field.value())}
							</dd>
						</div>
					)}
				</For>
			</dl>
		</div>
	);
}
