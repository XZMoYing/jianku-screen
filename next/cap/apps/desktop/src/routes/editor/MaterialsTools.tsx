import { Button } from "@cap/ui-solid";
import { Select } from "@kobalte/core/select";
import {
	createMemo,
	createResource,
	createSignal,
	For,
	Match,
	Show,
	Switch,
} from "solid-js";
import { listSystemFonts } from "~/utils/fonts";
import { t as localize } from "~/utils/i18n";
import { AudioLibraryPanel } from "./AudioLibrary";
import { CLIP_TRANSITION_OPTIONS } from "./clip-transitions";
import { useEditorContext } from "./context";
import { SHAPE_KINDS, shapeKindLabel } from "./shapes";
import { TextPresetCard } from "./TextPresetCard";
import { TEXT_PRESET_GROUPS, TEXT_PRESETS } from "./text-presets";
import { MenuItem, MenuItemList, PopperContent, SectionLabel } from "./ui";
import { formatTime } from "./utils";

export function MaterialsTools(props: {
	category: string | undefined;
	onClose: () => void;
}) {
	const { timelineCommands, editorState, projectActions, project, meta } =
		useEditorContext();
	const audioMode = () => {
		const index = editorState.timeline.audioReplace;
		return index == null
			? {
					type: "add" as const,
					lane:
						editorState.timeline.audioPicker ??
						timelineCommands.nextAudioLane(),
				}
			: { type: "replace" as const, index };
	};

	return (
		<Switch>
			<Match when={props.category === "audio"}>
				<AudioLibraryPanel mode={audioMode()} onClose={props.onClose} />
			</Match>
			<Match when={props.category === "text"}>
				<TextMaterials />
			</Match>
			<Match when={props.category === "graphics"}>
				<Button
					variant="gray"
					disabled={editorState.importingImage}
					onClick={() => timelineCommands.addTrackContent("image")}
				>
					{localize("导入图片")}
				</Button>
				<Button
					variant="gray"
					onClick={() => timelineCommands.addTrackContent("mask")}
				>
					{localize("添加遮罩")}
				</Button>
				<SectionLabel name={localize("标注形状")} />
				<div class="grid grid-cols-2 gap-1.5">
					<For each={SHAPE_KINDS}>
						{(shape) => (
							<Button
								variant="gray"
								onClick={() =>
									timelineCommands.addTrackContent("shape", 3, { shape })
								}
							>
								{localize(shapeKindLabel(shape))}
							</Button>
						)}
					</For>
				</div>
			</Match>
			<Match when={props.category === "motion"}>
				<Show
					when={
						meta().hasRecordedCursorData &&
						!project.timeline?.zoomSegments.length
					}
				>
					<Button
						variant="gray"
						disabled={editorState.timeline.generatingAutoZoom}
						onClick={() => void timelineCommands.generateAutoZoom()}
					>
						{localize("生成全片自动缩放")}
					</Button>
				</Show>
				<Button
					variant="gray"
					onClick={() => void timelineCommands.addZoomAtPlayhead("auto")}
				>
					{localize("添加跟随光标的缩放")}
				</Button>
				<Button
					variant="gray"
					onClick={() =>
						void timelineCommands.addZoomAtPlayhead({
							manual: { x: 0.5, y: 0.5 },
						})
					}
				>
					{localize("添加固定焦点缩放")}
				</Button>
				<Button variant="gray" onClick={() => projectActions.addCamera3DShot()}>
					{localize("添加 3D 镜头")}
				</Button>
				<Button
					variant="gray"
					onClick={() => timelineCommands.addTrackContent("style")}
				>
					{localize("添加样式片段")}
				</Button>
			</Match>
			<Match when={props.category === "transitions"}>
				<TransitionMaterials />
			</Match>
		</Switch>
	);
}

function TextMaterials() {
	const { timelineCommands } = useEditorContext();
	const [fonts] = createResource(listSystemFonts, { initialValue: [] });
	const [group, setGroup] = createSignal(TEXT_PRESET_GROUPS[0]);
	const presets = () =>
		group() === TEXT_PRESET_GROUPS[0]
			? TEXT_PRESETS
			: TEXT_PRESETS.filter((preset) => preset.group === group());
	return (
		<>
			<Button
				variant="gray"
				onClick={() => timelineCommands.addTrackContent("text")}
			>
				{localize("添加文字")}
			</Button>
			<Button variant="gray" onClick={timelineCommands.openCaptionInspector}>
				{localize("智能字幕")}
			</Button>
			<SectionLabel name={localize("文字模板")} />
			<div class="flex gap-1.5 overflow-x-auto hide-scroll">
				<For each={TEXT_PRESET_GROUPS}>
					{(item) => (
						<button
							type="button"
							aria-pressed={item === group()}
							class="jk-ed-tile h-7 shrink-0 px-2.5 text-xs"
							onClick={() => setGroup(item)}
						>
							{localize(item)}
						</button>
					)}
				</For>
			</div>
			<div class="grid grid-cols-2 gap-2">
				<For each={presets()}>
					{(preset) => (
						<TextPresetCard
							preset={preset}
							active={false}
							onApply={() =>
								timelineCommands.addTrackContent("text", 3, {
									textPreset: preset,
									installedFonts: fonts.latest ?? [],
								})
							}
						/>
					)}
				</For>
			</div>
		</>
	);
}

function TransitionMaterials() {
	const { editorState, timelineCommands } = useEditorContext();
	const [targetId, setTargetId] = createSignal<string>();
	const destinations = createMemo(() =>
		timelineCommands.transitionDestinations().map((item) => ({
			...item,
			key: item.id ?? String(item.index),
			label: `${formatTime(item.time)} · ${item.name}`,
		})),
	);
	const chosen = () => {
		const list = destinations();
		const selection = editorState.timeline.selection;
		const preferred = list.find(
			(item) =>
				item.key === targetId() ||
				(targetId() === undefined &&
					selection?.type === "transition" &&
					selection.index === item.index),
		);
		return (
			preferred ??
			list.reduce<(typeof list)[number] | undefined>(
				(closest, item) =>
					!closest ||
					Math.abs(item.time - editorState.playbackTime) <
						Math.abs(closest.time - editorState.playbackTime)
						? item
						: closest,
				undefined,
			)
		);
	};
	return (
		<Show
			when={destinations().length > 0}
			fallback={
				<p class="px-2 py-3 text-xs text-ed-text-3">
					{localize("相邻视频片段之间可以添加转场。")}
				</p>
			}
		>
			<Select
				options={destinations()}
				optionValue="key"
				optionTextValue="label"
				value={chosen()}
				onChange={(item) => setTargetId(item?.key)}
				disallowEmptySelection
				itemComponent={(props) => (
					<MenuItem<typeof Select.Item> as={Select.Item} item={props.item}>
						<Select.ItemLabel>{props.item.rawValue.label}</Select.ItemLabel>
					</MenuItem>
				)}
			>
				<Select.Trigger
					aria-label={localize("转场位置")}
					class="jk-choice-trigger"
				>
					<Select.Value<
						ReturnType<typeof destinations>[number]
					> class="truncate">
						{(state) => state.selectedOption()?.label}
					</Select.Value>
					<IconCapChevronDown class="size-3.5 shrink-0 text-ed-text-3" />
				</Select.Trigger>
				<Select.Portal>
					<PopperContent<typeof Select.Content>
						as={Select.Content}
						class="z-80"
					>
						<MenuItemList<typeof Select.Listbox>
							as={Select.Listbox}
							class="max-h-56 overflow-y-auto"
						/>
					</PopperContent>
				</Select.Portal>
			</Select>
			<div class="jk-ed-card grid grid-cols-2 gap-1.5 p-2.5">
				<For each={CLIP_TRANSITION_OPTIONS}>
					{([type, label]) => (
						<button
							type="button"
							aria-pressed={chosen()?.transition?.type === type}
							class="jk-ed-tile h-8 px-2 text-xs"
							onClick={() => {
								const cut = chosen();
								if (cut)
									timelineCommands.setTransitionFromMaterials(cut.index, type);
							}}
						>
							{localize(label)}
						</button>
					)}
				</For>
			</div>
		</Show>
	);
}
