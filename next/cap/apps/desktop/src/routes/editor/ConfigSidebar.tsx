import { NumberField } from "@kobalte/core";
import { Collapsible as KCollapsible } from "@kobalte/core/collapsible";
import { RadioGroup } from "@kobalte/core/radio-group";
import { Select as KSelect } from "@kobalte/core/select";
import { Tabs as KTabs } from "@kobalte/core/tabs";
import { createElementBounds } from "@solid-primitives/bounds";
import { createEventListenerMap } from "@solid-primitives/event-listener";
import { convertFileSrc } from "@tauri-apps/api/core";
import { cx } from "cva";
import {
	batch,
	createEffect,
	createMemo,
	createRoot,
	createSignal,
	For,
	Index,
	lazy,
	on,
	Show,
	Suspense,
	type ValidComponent,
} from "solid-js";
import { createStore, produce } from "solid-js/store";
import { Dynamic } from "solid-js/web";
import toast from "solid-toast";
import { BackgroundSettings } from "~/components/BackgroundSettings";
import { CameraSettings } from "~/components/CameraSettings";
import { CursorSettings } from "~/components/CursorSettings";
import { MotionGroup, MotionSwitch } from "~/components/InterfaceMotion";
import { LayoutSettings } from "~/components/LayoutSettings";
import { Toggle } from "~/components/Toggle";
import { audioEnhancementStore, generalSettingsStore } from "~/store";
import { t as localize } from "~/utils/i18n";
import {
	createSelectedOrganization,
	getOrganizationBrandColorSwatches,
	type OrganizationBrandColorSwatch,
} from "~/utils/organization-branding";
import type {
	CaptionTrackSegment,
	ClipOffsets,
	KeyboardTrackSegment,
	NotchConfiguration,
	SceneMode,
	SceneSegment,
	SplitLayout,
	StereoMode,
	TimelineSegment,
	VoiceIsolation,
	XY,
	ZoomSegment,
} from "~/utils/tauri";
import IconLucideColumns2 from "~icons/lucide/columns-2";
import IconLucideEyeOff from "~icons/lucide/eye-off";
import IconLucideKeyboard from "~icons/lucide/keyboard";
import IconLucideMonitor from "~icons/lucide/monitor";
import IconLucideVideo from "~icons/lucide/video";
import IconLucideX from "~icons/lucide/x";
import { AudioLibraryPanel } from "./AudioLibrary";
import {
	AUDIO_TRACK_BG_CLASS,
	type AudioTrackSegment,
	MAX_VOLUME_DB,
	MIN_VOLUME_DB,
} from "./audio";
import { ColorCorrectionSection } from "./ColorCorrectionSection";
import { recordedCursorFamily } from "./CursorStylePicker";
import { syncCaptionWordsWithText } from "./captions";
import { type ClipTransition, clipSourceTimeAt } from "./clip-transitions";
import { EditorStyleContext, useEditorContext } from "./context";
import { ImageSegmentConfig } from "./image-segment-config";
import { KeyboardTab } from "./KeyboardTab";
import {
	encodeMaskEffect,
	getMaskEffect,
	getMaskEffectAmount,
	type MaskEffect,
	type MaskKind,
	type MaskSegment,
} from "./masks";
import {
	DEFAULT_SCENE_TRANSITION,
	DEFAULT_SPLIT_LAYOUT,
} from "./projectConfig";
import { selectedSegmentLabel } from "./selection-label";
import { StyleGroupToggle, StyleSegmentConfig } from "./style-segment-config";
import type { TextSegment } from "./text";
import { TextSegmentConfig } from "./text-segment-config";
import type { Camera3DSegment } from "./three-d";
import { Camera3DShotPanel, camera3DShotSummary } from "./three-d-panel";
import { heldTimeBefore, holdWindows } from "./timeline-holds";
import {
	ComingSoonTooltip,
	EditorButton,
	Field,
	Input,
	MenuItem,
	MenuItemList,
	PopperContent,
	Section,
	SectionLabel,
	Slider,
	Subfield,
	topSlideAnimateClasses,
} from "./ui";
import { formatTime } from "./utils";
import { ZoomModeHelper } from "./ZoomModeHelper";

// Split out of the sidebar chunk: the captions tab is not visible at first
// paint (Kobalte only mounts the selected tab), and its code is heavy. The
// render site wraps it in a local <Suspense> so the chunk load stays inside
// the tab instead of bubbling to the editor's top-level Suspense.
const CaptionsTab = lazy(() =>
	import("./CaptionsTab").then((m) => ({ default: m.CaptionsTab })),
);

// Null placement means "use the recording's own measurements", so untouched
// sliders must stay null rather than being written out at their displayed value.
const UNPLACED_NOTCH = {
	enabled: false,
	x: null,
	width: null,
	height: null,
} satisfies NotchConfiguration;

const STEREO_MODES = [
	{ name: "Stereo", value: "stereo" },
	{ name: "Mono L", value: "monoL" },
	{ name: "Mono R", value: "monoR" },
] satisfies Array<{ name: string; value: StereoMode }>;

const formatVolumeDb = (value: number) =>
	value <= -30
		? localize("静音")
		: `${value > 0 ? "+" : ""}${value.toFixed(1)} dB`;

const TAB_IDS = {
	background: "background",
	camera: "camera",
	transcript: "transcript",
	audio: "audio",
	cursor: "cursor",
	keyboard: "keyboard",
	hotkeys: "hotkeys",
	captions: "captions",
} as const;

export function ConfigSidebar() {
	const context = useEditorContext();
	return (
		<Show when={context.styleScopeToken()} keyed>
			{(_scope) => (
				<EditorStyleContext.Provider
					value={{
						...context,
						project: context.styleProject,
						setProject: context.createStyleProjectSetter(),
					}}
				>
					<ConfigSidebarContent />
				</EditorStyleContext.Provider>
			)}
		</Show>
	);
}

function StudioSoundCard() {
	const { project, setProject } = useEditorContext();
	const audioEnhancement = audioEnhancementStore.createQuery();
	const [savingDefault, setSavingDefault] = createSignal(false);
	const enabled = () => project.audio.improve;
	const isolationOptions = [
		{
			value: "light",
			label: "轻度",
			description: "Keep more of your original voice and room sound.",
		},
		{
			value: "balanced",
			label: "均衡",
			description: "Clearer isolation with natural voice detail.",
		},
		{
			value: "strong",
			label: "强力",
			description: "More isolation for noisy spaces. May change voice texture.",
		},
	] satisfies { value: VoiceIsolation; label: string; description: string }[];

	return (
		<div class="flex flex-col p-3.5 rounded-xl bg-ed-card-2">
			<div class="flex flex-row gap-2.5 items-center">
				<div
					class="flex justify-center items-center rounded-[9px] size-[30px] shrink-0 transition-colors"
					classList={{
						"bg-ed-accent/12 text-ed-accent": enabled(),
						"bg-ed-ctl text-ed-text-2": !enabled(),
					}}
				>
					<IconCapMicrophone class="size-4" />
				</div>
				<div class="flex flex-col flex-1 gap-0.5 min-w-0">
					<span class="text-[13px] font-medium text-ed-text-1">
						{localize("Studio Sound")}
					</span>
					<span class="text-xs leading-4 text-ed-text-3">
						{localize(
							"Reduces background noise and balances your voice level.",
						)}
					</span>
				</div>
				<Toggle
					checked={enabled()}
					onChange={(value) => setProject("audio", "improve", value)}
				/>
			</div>
			<Show when={enabled()}>
				<RadioGroup
					aria-label={localize("Voice isolation")}
					value={project.audio.isolation}
					disabled={savingDefault() || audioEnhancement.isPending}
					onChange={async (value) => {
						const option = isolationOptions.find(
							(option) => option.value === value,
						);
						if (!option) return;
						setProject("audio", "isolation", option.value);
						if (!audioEnhancement.data?.enabledByDefault) return;
						setSavingDefault(true);
						try {
							await audioEnhancementStore.set({ isolation: option.value });
							await audioEnhancement.refetch();
						} catch {
							toast.error(localize("Could not save the Studio Sound default"));
						} finally {
							setSavingDefault(false);
						}
					}}
					class="flex gap-0.5 p-0.5 mt-3 rounded-lg bg-ed-ctl"
				>
					<For each={isolationOptions}>
						{(option) => (
							<RadioGroup.Item value={option.value} class="flex-1 min-w-0">
								<RadioGroup.ItemInput class="sr-only peer" />
								<RadioGroup.ItemLabel class="flex justify-center py-1 text-xs font-medium rounded-md cursor-pointer text-ed-text-2 peer-focus-visible:ring-2 peer-focus-visible:ring-ed-accent data-checked:bg-ed-card data-checked:text-ed-text-1 data-disabled:opacity-50">
									{localize(option.label)}
								</RadioGroup.ItemLabel>
							</RadioGroup.Item>
						)}
					</For>
				</RadioGroup>
				<p class="mt-2 text-xs leading-4 text-ed-text-3">
					{
						isolationOptions.find(
							(option) => option.value === project.audio.isolation,
						)?.description
					}
				</p>
			</Show>
			<div class="flex flex-row gap-2.5 justify-between items-center pt-3 mt-3 border-t border-ed-line">
				<span class="text-xs text-ed-text-2">
					{localize("Use for new recordings")}
				</span>
				<Toggle
					size="sm"
					checked={audioEnhancement.data?.enabledByDefault ?? true}
					disabled={audioEnhancement.isPending || savingDefault()}
					onChange={async (value) => {
						setSavingDefault(true);
						try {
							await audioEnhancementStore.set({
								enabledByDefault: value,
								isolation: project.audio.isolation,
							});
							await audioEnhancement.refetch();
						} catch {
							toast.error(localize("Could not save the Studio Sound default"));
						} finally {
							setSavingDefault(false);
						}
					}}
				/>
			</div>
		</div>
	);
}

function ConfigSidebarContent() {
	const {
		project,
		selectedStyle,
		setProject,
		setEditorState,
		projectActions,
		editorInstance,
		editorState,
		meta,
	} = useEditorContext();
	const organizationSelection = createSelectedOrganization();
	const brandColorSwatches = createMemo(() =>
		getOrganizationBrandColorSwatches(
			organizationSelection.selectedOrganization(),
		),
	);

	const [state, setState] = createStore({
		selectedTab: "background" as
			| "background"
			| "camera"
			| "transcript"
			| "audio"
			| "cursor"
			| "keyboard"
			| "hotkeys"
			| "captions",
	});

	// Clip selection is a timeline-only affordance (highlight, Delete key,
	// multi-select); it must not swap the sidebar away from the current tab.
	const sidebarSelection = () => {
		const selection = editorState.timeline.selection;
		return selection && selection.type !== "clip" && selection.type !== "style"
			? selection
			: null;
	};

	createEffect(() => {
		if (
			selectedStyle() &&
			state.selectedTab !== "background" &&
			state.selectedTab !== "camera" &&
			state.selectedTab !== "cursor"
		)
			setState("selectedTab", "background");
	});
	let scrollRef!: HTMLDivElement;

	let selectionScrollRef!: HTMLDivElement;
	let previousStyle: number | null = null;
	createEffect(() => {
		const index = editorState.styleEditIndex;
		if (index !== previousStyle) {
			previousStyle = index;
			scrollRef?.scrollTo({ top: 0 });
		}
	});
	let previousSelection = "";
	createEffect(() => {
		const selection = sidebarSelection();
		const key = selection
			? `${selection.type}:${"indices" in selection ? selection.indices.join(",") : selection.index}`
			: "";
		if (key !== previousSelection) {
			previousSelection = key;
			selectionScrollRef?.scrollTo({ top: 0 });
		}
	});

	return (
		<KTabs
			value={
				sidebarSelection() || editorState.timeline.audioPicker !== null
					? undefined
					: state.selectedTab
			}
			class="jk-inspector flex overflow-hidden z-10 flex-col flex-1 min-h-0 min-w-0 rounded-xl shrink-0 bg-ed-card shadow-ed-card"
		>
			<KTabs.List class="jk-inspector-tabs flex sticky top-0 z-60 flex-row justify-around items-center px-2.5 h-[46px] border-b border-ed-line shrink-0 bg-ed-card">
				<MotionGroup
					class="jk-inspector-tab-motion"
					label={localize("编辑设置")}
				>
					<For
						each={[
							{ id: TAB_IDS.background, icon: IconCapImage },
							{
								id: TAB_IDS.camera,
								icon: IconCapCamera,
								disabled: editorInstance.recordings.segments.every(
									(s) => s.camera === null,
								),
							},
							{ id: TAB_IDS.audio, icon: IconCapAudioOn },
							{
								id: TAB_IDS.cursor,
								icon: IconCapCursor,
								disabled: !meta().hasRecordedCursorData,
							},
							{
								id: TAB_IDS.keyboard,
								icon: IconLucideKeyboard,
							},
							{
								id: TAB_IDS.captions,
								icon: IconCapMessageBubble,
							},
							// { id: "hotkeys" as const, icon: IconCapHotkeys },
						].filter(
							(item) =>
								!selectedStyle() ||
								item.id === "background" ||
								item.id === "camera" ||
								item.id === "cursor",
						)}
					>
						{(item) => (
							<KTabs.Trigger
								value={item.id}
								data-inspector-tab={item.id}
								aria-label={localize(
									item.id === "background"
										? "背景"
										: item.id.charAt(0).toUpperCase() + item.id.slice(1),
								)}
								title={localize(
									item.id === "background"
										? "背景"
										: item.id.charAt(0).toUpperCase() + item.id.slice(1),
								)}
								class="flex justify-center items-center w-10 h-[30px] rounded-[9px] transition-colors shrink-0 outline-hidden focus-visible:ring-1 focus-visible:ring-ed-accent text-ed-text-2 hover:bg-ed-ctl hover:text-ed-text-1 data-selected:bg-ed-ctl-hover data-selected:text-ed-text-1 disabled:text-ed-text-3 disabled:opacity-60 disabled:hover:bg-transparent"
								onClick={() => {
									// Clear any active selection first
									if (sidebarSelection()) {
										setEditorState("timeline", "selection", null);
									}
									if (editorState.timeline.audioPicker !== null) {
										setEditorState("timeline", "audioPicker", null);
									}
									if (editorState.timeline.audioReplace !== null) {
										setEditorState("timeline", "audioReplace", null);
									}
									setState("selectedTab", item.id);
									scrollRef.scrollTo({
										top: 0,
									});
								}}
								disabled={item.disabled}
							>
								<Dynamic component={item.icon} class="size-4" />
								<span class="jk-tab-label">
									{localize(
										{
											background: "画面",
											camera: "摄像",
											audio: "声音",
											cursor: "光标",
											keyboard: "按键",
											captions: "字幕",
											hotkeys: "快捷键",
										}[item.id],
									)}
								</span>
							</KTabs.Trigger>
						)}
					</For>
				</MotionGroup>
			</KTabs.List>
			<div
				ref={scrollRef}
				style={{
					"--margin-top-scroll": "5px",
				}}
				class="custom-scroll overscroll-contain overflow-x-hidden overflow-y-auto text-[0.875rem] flex-1 min-h-0"
				classList={{
					hidden:
						!!sidebarSelection() ||
						editorState.timeline.audioPicker !== null ||
						editorState.timeline.audioReplace !== null,
				}}
			>
				<MotionSwitch value={state.selectedTab}>
					{(displayed) => (
						<KTabs value={displayed()}>
							<StyleSegmentConfig />
							<BackgroundConfig
								scrollRef={scrollRef}
								brandColorSwatches={brandColorSwatches()}
							/>
							<CameraConfig scrollRef={scrollRef} />
							<KTabs.Content
								value="audio"
								class="flex flex-col flex-1 gap-3.5 pt-3.5 px-4 pb-4 min-h-0"
							>
								<Section name={localize("Audio")}>
									<Subfield name={localize("Mute Audio")}>
										<Toggle
											checked={project.audio.mute}
											onChange={(v) => setProject("audio", "mute", v)}
										/>
									</Subfield>
									{editorInstance.recordings.segments[0].mic?.channels ===
										2 && (
										<Subfield name={localize("Microphone Stereo Mode")}>
											<KSelect<{ name: string; value: StereoMode }>
												options={STEREO_MODES}
												optionValue="value"
												optionTextValue="name"
												value={STEREO_MODES.find(
													(v) => v.value === project.audio.micStereoMode,
												)}
												onChange={(v) => {
													if (v) setProject("audio", "micStereoMode", v.value);
												}}
												disallowEmptySelection
												itemComponent={(props) => (
													<MenuItem<typeof KSelect.Item>
														as={KSelect.Item}
														item={props.item}
													>
														<KSelect.ItemLabel class="flex-1">
															{props.item.rawValue.name}
														</KSelect.ItemLabel>
													</MenuItem>
												)}
											>
												<KSelect.Trigger class="flex flex-row gap-1.5 items-center px-2 w-full h-[26px] rounded-[7px] transition-colors bg-ed-ctl hover:bg-ed-ctl-hover outline-hidden disabled:text-ed-text-3">
													<KSelect.Value<{
														name: string;
														value: StereoMode;
													}> class="flex-1 text-[12px] text-left truncate text-ed-text-1 font-normal">
														{(state) => (
															<span>{state.selectedOption().name}</span>
														)}
													</KSelect.Value>
													<KSelect.Icon<ValidComponent>
														as={(props) => (
															<IconCapChevronDown
																{...props}
																class="size-3.5 shrink-0 transform transition-transform data-expanded:rotate-180 text-ed-text-3"
															/>
														)}
													/>
												</KSelect.Trigger>
												<KSelect.Portal>
													<PopperContent<typeof KSelect.Content>
														as={KSelect.Content}
														class={cx(topSlideAnimateClasses, "z-50")}
													>
														<MenuItemList<typeof KSelect.Listbox>
															class="overflow-y-auto max-h-32"
															as={KSelect.Listbox}
														/>
													</PopperContent>
												</KSelect.Portal>
											</KSelect>
										</Subfield>
									)}

									<Show when={meta().hasMicrophone}>
										<StudioSoundCard />
									</Show>
								</Section>
								{meta().hasMicrophone && (
									<Field
										inline
										name={localize("Microphone Volume")}
										value={formatVolumeDb(project.audio.micVolumeDb ?? 0)}
									>
										<Slider
											disabled={project.audio.mute}
											value={[project.audio.micVolumeDb ?? 0]}
											onChange={(v) => setProject("audio", "micVolumeDb", v[0])}
											minValue={-30}
											maxValue={10}
											step={0.1}
											formatTooltip={(v) =>
												v <= -30
													? localize("静音")
													: `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`
											}
										/>
									</Field>
								)}
								{meta().hasSystemAudio && (
									<Field
										inline
										name={localize("System Audio Volume")}
										value={formatVolumeDb(project.audio.systemVolumeDb ?? 0)}
									>
										<Slider
											disabled={project.audio.mute}
											value={[project.audio.systemVolumeDb ?? 0]}
											onChange={(v) =>
												setProject("audio", "systemVolumeDb", v[0])
											}
											minValue={-30}
											maxValue={10}
											step={0.1}
											formatTooltip={(v) =>
												v <= -30
													? localize("静音")
													: `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`
											}
										/>
									</Field>
								)}
								<SyncOffsetsConfig />
							</KTabs.Content>
							<KTabs.Content
								value="cursor"
								class="flex flex-col flex-1 gap-3.5 pt-3.5 px-4 pb-4 min-h-0"
							>
								<StyleGroupToggle group="cursor" />
								<Show
									when={
										!selectedStyle() ||
										selectedStyle()?.overrides.cursor != null
									}
								>
									<CursorSettings
										cursor={project.cursor}
										recorded={recordedCursorFamily(meta())}
										onChange={(patch) => setProject("cursor", patch)}
									/>
								</Show>
							</KTabs.Content>
							<KTabs.Content
								value="hotkeys"
								class="flex flex-1 pt-3.5 px-4 pb-4 min-h-0"
							>
								<Section name="Hotkeys">
									<ComingSoonTooltip>
										<Subfield name="Show hotkeys">
											<Toggle disabled />
										</Subfield>
									</ComingSoonTooltip>
								</Section>
							</KTabs.Content>
							<KTabs.Content
								value={TAB_IDS.captions}
								class="flex flex-col flex-1 gap-3.5 pt-3.5 px-4 pb-4 min-h-0"
							>
								<Suspense>
									<CaptionsTab brandColorSwatches={brandColorSwatches()} />
								</Suspense>
							</KTabs.Content>
							<KTabs.Content
								value={TAB_IDS.keyboard}
								class="flex flex-col flex-1 gap-3.5 pt-3.5 px-4 pb-4 min-h-0"
							>
								<KeyboardTab brandColorSwatches={brandColorSwatches()} />
							</KTabs.Content>
						</KTabs>
					)}
				</MotionSwitch>
			</div>
			<div
				ref={selectionScrollRef}
				style={{
					"--margin-top-scroll": "5px",
				}}
				class="custom-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pt-3.5 px-4 pb-4 text-[0.875rem] space-y-3.5 bg-ed-card z-50"
				classList={{
					hidden:
						!sidebarSelection() &&
						editorState.timeline.audioPicker === null &&
						editorState.timeline.audioReplace === null,
					"animate-in slide-in-from-bottom-2 fade-in":
						!!sidebarSelection() ||
						editorState.timeline.audioPicker !== null ||
						editorState.timeline.audioReplace !== null,
				}}
			>
				<Show
					when={
						editorState.timeline.audioPicker !== null &&
						!sidebarSelection() &&
						editorState.timeline.audioReplace === null
					}
				>
					<AudioLibraryPanel
						mode={{
							type: "add",
							lane: editorState.timeline.audioPicker ?? 0,
						}}
						onClose={() => setEditorState("timeline", "audioPicker", null)}
					/>
				</Show>
				<Show
					when={(() => {
						const index = editorState.timeline.audioReplace;
						if (index === null) return null;
						const segment = project.timeline?.audioSegments?.[index];
						if (!segment) {
							setEditorState("timeline", "audioReplace", null);
							return null;
						}
						return { index };
					})()}
				>
					{(value) => (
						<AudioLibraryPanel
							mode={{ type: "replace", index: value().index }}
							onClose={() => setEditorState("timeline", "audioReplace", null)}
						/>
					)}
				</Show>
				<Show
					when={
						editorState.timeline.audioReplace === null
							? sidebarSelection()
							: null
					}
				>
					{(selection) => (
						<Suspense>
							<Show when={selection().type === "image"}>
								<For
									each={
										selection().type === "image"
											? (selection() as { type: "image"; indices: number[] })
													.indices
											: []
									}
								>
									{(index) => <ImageSegmentConfig index={index} />}
								</For>
							</Show>
							<Show
								when={(() => {
									const captionSelection = selection();
									if (captionSelection.type !== "caption") return;

									const segments = captionSelection.indices
										.map((index) => ({
											index,
											segment: project.timeline?.captionSegments?.[index],
										}))
										.filter(
											(
												item,
											): item is {
												index: number;
												segment: CaptionTrackSegment;
											} => item.segment !== undefined,
										);

									if (segments.length === 0) {
										setEditorState("timeline", "selection", null);
										return;
									}

									return { selection: captionSelection, segments };
								})()}
							>
								{(value) => (
									<div class="space-y-4">
										<div class="flex flex-row justify-between items-center">
											<div class="flex gap-2 items-center">
												<EditorButton
													onClick={() =>
														setEditorState("timeline", "selection", null)
													}
													leftIcon={<IconLucideCheck />}
												>
													{localize("Done")}
												</EditorButton>
												<span class="text-[12px] text-ed-text-2">
													{selectedSegmentLabel(
														"caption",
														value().segments.length,
													)}
												</span>
											</div>
											<EditorButton
												variant="danger"
												onClick={() =>
													projectActions.deleteCaptionSegments(
														value().segments.map((s) => s.index),
													)
												}
												leftIcon={<IconCapTrash />}
											>
												{localize("Delete")}
											</EditorButton>
										</div>
										<For each={value().segments}>
											{(item) => (
												<div class="p-3.5 rounded-xl bg-ed-card-2">
													<CaptionSegmentConfig
														segment={item.segment}
														segmentIndex={item.index}
													/>
												</div>
											)}
										</For>
									</div>
								)}
							</Show>
							<Show
								when={(() => {
									const keyboardSelection = selection();
									if (keyboardSelection.type !== "keyboard") return;

									const segments = keyboardSelection.indices
										.map((index) => ({
											index,
											segment: project.timeline?.keyboardSegments?.[index],
										}))
										.filter(
											(
												item,
											): item is {
												index: number;
												segment: KeyboardTrackSegment;
											} => item.segment !== undefined,
										);

									if (segments.length === 0) {
										setEditorState("timeline", "selection", null);
										return;
									}

									return { selection: keyboardSelection, segments };
								})()}
							>
								{(value) => (
									<div class="space-y-4">
										<div class="flex flex-row justify-between items-center">
											<div class="flex gap-2 items-center">
												<EditorButton
													onClick={() => {
														setEditorState("timeline", "selection", null);
														setState("selectedTab", TAB_IDS.keyboard);
													}}
													leftIcon={<IconLucideCheck />}
												>
													{localize("Done")}
												</EditorButton>
												<span class="text-[12px] text-ed-text-2">
													{selectedSegmentLabel(
														"keyboard",
														value().segments.length,
													)}
												</span>
											</div>
											<EditorButton
												variant="danger"
												onClick={() =>
													projectActions.deleteKeyboardSegments(
														value().segments.map((s) => s.index),
													)
												}
												leftIcon={<IconCapTrash />}
											>
												{localize("Delete")}
											</EditorButton>
										</div>
										<For each={value().segments}>
											{(item) => (
												<div class="p-3.5 rounded-xl bg-ed-card-2">
													<KeyboardSegmentConfig
														segment={item.segment}
														segmentIndex={item.index}
													/>
												</div>
											)}
										</For>
									</div>
								)}
							</Show>
							<Show
								when={(() => {
									const textSelection = selection();
									if (textSelection.type !== "text") return;

									const segments = textSelection.indices
										.map((index) => ({
											index,
											segment: project.timeline?.textSegments?.[index],
										}))
										.filter(
											(item): item is { index: number; segment: TextSegment } =>
												item.segment !== undefined,
										);

									if (segments.length === 0) {
										setEditorState("timeline", "selection", null);
										return;
									}
									return { selection: textSelection, segments };
								})()}
							>
								{(value) => (
									<div class="space-y-4">
										<div class="flex flex-row justify-between items-center">
											<div class="flex gap-2 items-center">
												<EditorButton
													onClick={() =>
														setEditorState("timeline", "selection", null)
													}
													leftIcon={<IconLucideCheck />}
												>
													{localize("Done")}
												</EditorButton>
												<span class="text-[12px] text-ed-text-2">
													{selectedSegmentLabel(
														"text",
														value().segments.length,
													)}
												</span>
											</div>
											<EditorButton
												variant="danger"
												onClick={() =>
													projectActions.deleteTextSegments(
														value().segments.map((s) => s.index),
													)
												}
												leftIcon={<IconCapTrash />}
											>
												{localize("Delete")}
											</EditorButton>
										</div>
										<For each={value().segments}>
											{(item) => (
												<div class="p-3.5 rounded-xl bg-ed-card-2">
													<TextSegmentConfig
														segment={item.segment}
														segmentIndex={item.index}
														brandColorSwatches={brandColorSwatches()}
													/>
												</div>
											)}
										</For>
									</div>
								)}
							</Show>
							<Show
								when={(() => {
									const audioSelection = selection();
									if (audioSelection.type !== "audio") return;

									const segments = audioSelection.indices
										.map((index) => ({
											index,
											segment: project.timeline?.audioSegments?.[index],
										}))
										.filter(
											(
												item,
											): item is {
												index: number;
												segment: AudioTrackSegment;
											} => item.segment !== undefined,
										);

									if (segments.length === 0) {
										setEditorState("timeline", "selection", null);
										return;
									}
									return { selection: audioSelection, segments };
								})()}
							>
								{(value) => (
									<div class="space-y-4">
										<div class="flex flex-row justify-between items-center">
											<div class="flex gap-2 items-center">
												<EditorButton
													onClick={() =>
														setEditorState("timeline", "selection", null)
													}
													leftIcon={<IconLucideCheck />}
												>
													{localize("Done")}
												</EditorButton>
												<span class="text-[12px] text-ed-text-2">
													{selectedSegmentLabel(
														"audio",
														value().segments.length,
													)}
												</span>
											</div>
											<EditorButton
												variant="danger"
												onClick={() =>
													projectActions.deleteAudioSegments(
														value().segments.map((s) => s.index),
													)
												}
												leftIcon={<IconCapTrash />}
											>
												{localize("Delete")}
											</EditorButton>
										</div>
										<For each={value().segments}>
											{(item) => (
												<div class="p-3.5 rounded-xl bg-ed-card-2">
													<AudioSegmentConfig
														segment={item.segment}
														segmentIndex={item.index}
													/>
												</div>
											)}
										</For>
									</div>
								)}
							</Show>
							<Show
								when={(() => {
									const maskSelection = selection();
									if (maskSelection.type !== "mask") return;

									const segments = maskSelection.indices
										.map((index) => ({
											index,
											segment: project.timeline?.maskSegments?.[index],
										}))
										.filter(
											(item): item is { index: number; segment: MaskSegment } =>
												item.segment !== undefined,
										);

									if (segments.length === 0) {
										setEditorState("timeline", "selection", null);
										return;
									}
									return { selection: maskSelection, segments };
								})()}
							>
								{(value) => (
									<div class="space-y-4">
										<div class="flex flex-row justify-between items-center">
											<div class="flex gap-2 items-center">
												<EditorButton
													onClick={() =>
														setEditorState("timeline", "selection", null)
													}
													leftIcon={<IconLucideCheck />}
												>
													{localize("Done")}
												</EditorButton>
												<span class="text-[12px] text-ed-text-2">
													{selectedSegmentLabel(
														"mask",
														value().segments.length,
													)}
												</span>
											</div>
											<EditorButton
												variant="danger"
												onClick={() =>
													projectActions.deleteMaskSegments(
														value().segments.map((s) => s.index),
													)
												}
												leftIcon={<IconCapTrash />}
											>
												{localize("Delete")}
											</EditorButton>
										</div>
										<For each={value().segments}>
											{(item) => (
												<div class="p-3.5 rounded-xl bg-ed-card-2">
													<MaskSegmentConfig
														segment={item.segment}
														segmentIndex={item.index}
													/>
												</div>
											)}
										</For>
									</div>
								)}
							</Show>
							<Show
								when={(() => {
									const zoomSelection = selection();
									if (zoomSelection.type !== "zoom") return;

									const segments = zoomSelection.indices
										.map((index) => ({
											index,
											segment: project.timeline?.zoomSegments?.[index],
										}))
										.filter(
											(item): item is { index: number; segment: ZoomSegment } =>
												item.segment !== undefined,
										);

									if (segments.length === 0) {
										setEditorState("timeline", "selection", null);
										return;
									}
									return { selection: zoomSelection, segments };
								})()}
							>
								{(value) => {
									const totalZoomSegments = () =>
										project.timeline?.zoomSegments?.length ?? 0;

									// The sidebar header is narrow, so the count stays terse and
									// "Select all" is an inline text action rather than a third
									// full button, which would wrap.
									const selectionLabel = () => {
										const count = value().segments.length;
										const total = totalZoomSegments();
										if (total > 1 && count === total)
											return `All ${total} selected`;
										if (total > 1) return `${count} of ${total} selected`;
										return `${count} selected`;
									};

									return (
										<div class="space-y-4">
											<div class="flex flex-row justify-between items-center">
												<div class="flex gap-2 items-center min-w-0">
													<EditorButton
														onClick={() =>
															setEditorState("timeline", "selection", null)
														}
														leftIcon={<IconLucideCheck />}
													>
														{localize("Done")}
													</EditorButton>
													<span class="text-[12px] text-ed-text-2 whitespace-nowrap">
														{selectionLabel()}
													</span>
													<Show
														when={value().segments.length < totalZoomSegments()}
													>
														<button
															type="button"
															class="text-[12px] font-medium whitespace-nowrap text-ed-accent hover:underline outline-hidden focus-visible:underline"
															onClick={() =>
																setEditorState("timeline", "selection", {
																	type: "zoom",
																	indices: Array.from(
																		{ length: totalZoomSegments() },
																		(_, i) => i,
																	),
																})
															}
														>
															{localize("Select all")}
														</button>
													</Show>
												</div>
												<EditorButton
													variant="danger"
													onClick={() => {
														projectActions.deleteZoomSegments(
															value().segments.map((s) => s.index),
														);
													}}
													leftIcon={<IconCapTrash />}
												>
													{localize("Delete")}
												</EditorButton>
											</div>
											<Show
												when={value().segments.length === 1}
												fallback={
													<ZoomMultiSegmentConfig segments={value().segments} />
												}
											>
												<For each={value().segments}>
													{(item) => (
														<div class="p-3.5 rounded-xl bg-ed-card-2">
															<ZoomSegmentConfig
																segment={item.segment}
																segmentIndex={item.index}
															/>
														</div>
													)}
												</For>
											</Show>
										</div>
									);
								}}
							</Show>
							<Show
								when={(() => {
									const camera3dSelection = selection();
									if (camera3dSelection.type !== "3d") return;

									const segments = camera3dSelection.indices
										.map((index) => ({
											index,
											segment: project.timeline?.camera3dSegments?.[index],
										}))
										.filter(
											(
												item,
											): item is { index: number; segment: Camera3DSegment } =>
												item.segment !== undefined,
										);

									if (segments.length === 0) {
										setEditorState("timeline", "selection", null);
										return;
									}
									return { selection: camera3dSelection, segments };
								})()}
							>
								{(value) => (
									<div class="space-y-3.5">
										<div class="flex flex-row gap-2 justify-between items-center">
											<div class="flex gap-2 items-center min-w-0">
												<EditorButton
													onClick={() =>
														setEditorState("timeline", "selection", null)
													}
													leftIcon={<IconLucideCheck />}
												>
													{localize("Done")}
												</EditorButton>
												<span class="text-[12px] truncate text-ed-text-2">
													<Show
														when={
															value().segments.length === 1 &&
															value().segments[0]
														}
														fallback={`${value().segments.length} 3D shots selected`}
													>
														{(item) => camera3DShotSummary(item().segment)}
													</Show>
												</span>
											</div>
											<div class="flex gap-1 items-center shrink-0">
												<Show
													when={
														value().segments.length === 1 && value().segments[0]
													}
												>
													{(item) => (
														<EditorButton
															onClick={() =>
																projectActions.playCamera3DShot(item().index)
															}
															leftIcon={<IconLucidePlay />}
														>
															{localize("Play shot")}
														</EditorButton>
													)}
												</Show>
												<EditorButton
													variant="danger"
													onClick={() => {
														projectActions.deleteCamera3DSegments(
															value().segments.map((s) => s.index),
														);
													}}
													leftIcon={<IconCapTrash />}
												>
													{localize("Delete")}
												</EditorButton>
											</div>
										</div>
										<Show
											when={
												value().segments.length === 1 && value().segments[0]
											}
										>
											{(item) => (
												<Camera3DShotPanel
													segment={item().segment}
													segmentIndex={item().index}
												/>
											)}
										</Show>
									</div>
								)}
							</Show>
							<Show
								when={(() => {
									const sceneSelection = selection();
									if (sceneSelection.type !== "scene") return;

									const segments = sceneSelection.indices
										.map((idx) => ({
											segment: project.timeline?.sceneSegments?.[idx],
											index: idx,
										}))
										.filter(
											(s): s is { segment: SceneSegment; index: number } =>
												s.segment !== undefined,
										);

									if (segments.length === 0) return;
									return { selection: sceneSelection, segments };
								})()}
							>
								{(value) => (
									<Show when={value().segments[0]}>
										{(firstSegment) => (
											<Show
												when={value().segments.length > 1}
												fallback={
													<SceneSegmentConfig
														segment={firstSegment().segment}
														segmentIndex={firstSegment().index}
													/>
												}
											>
												<div class="space-y-4">
													<div class="flex flex-row justify-between items-center">
														<div class="flex gap-2 items-center">
															<EditorButton
																onClick={() =>
																	setEditorState("timeline", "selection", null)
																}
																leftIcon={<IconLucideCheck />}
															>
																{localize("Done")}
															</EditorButton>
															<span class="text-[12px] text-ed-text-2">
																{selectedSegmentLabel(
																	"scene",
																	value().segments.length,
																)}
															</span>
														</div>
														<EditorButton
															variant="danger"
															onClick={() => {
																const indices = value().selection.indices;

																// Delete segments in reverse order to maintain indices
																[...indices]
																	.sort((a, b) => b - a)
																	.forEach((idx) => {
																		projectActions.deleteSceneSegment(idx);
																	});
															}}
															leftIcon={<IconCapTrash />}
														>
															{localize("Delete")}
														</EditorButton>
													</div>
												</div>
											</Show>
										)}
									</Show>
								)}
							</Show>
						</Suspense>
					)}
				</Show>
			</div>
		</KTabs>
	);
}

function BackgroundConfig(props: {
	scrollRef: HTMLDivElement;
	brandColorSwatches: OrganizationBrandColorSwatch[];
}) {
	const { project, setProject, editorInstance, projectHistory, selectedStyle } =
		useEditorContext();
	const notchXMax = () => {
		const width =
			project.background.notch?.width ?? editorInstance.notchBase.width;
		return 1 - Math.min(Math.max(width, 0), 1);
	};

	return (
		<KTabs.Content
			value={TAB_IDS.background}
			class="flex flex-col gap-3.5 pt-3.5 px-4 pb-4"
		>
			<StyleGroupToggle group="background" />
			<Show
				when={!selectedStyle() || selectedStyle()?.overrides.background != null}
			>
				<BackgroundSettings
					background={project.background}
					onChange={(patch) => setProject("background", patch)}
					projectPath={editorInstance.path}
					brandColorSwatches={props.brandColorSwatches}
					pauseHistory={projectHistory.pause}
				/>

				<div class="w-full border-t border-ed-line" />
				<SectionLabel name={localize("Layout")} />
				<LayoutSettings
					background={project.background}
					aspectRatio={project.aspectRatio}
					onAspectRatio={(ratio) => setProject("aspectRatio", ratio)}
					onChange={(patch) => setProject("background", patch)}
					motionBlur={
						project.screenMotionBlur ?? project.cursor.motionBlur ?? 1
					}
					onMotionBlur={(amount) => setProject("screenMotionBlur", amount)}
				/>
				<Field inline name="MacBook notch">
					<Toggle
						checked={project.background.notch?.enabled ?? false}
						onChange={(enabled) =>
							setProject("background", "notch", {
								...(project.background.notch ?? UNPLACED_NOTCH),
								enabled,
							})
						}
					/>
				</Field>
				<KCollapsible open={project.background.notch?.enabled ?? false}>
					<KCollapsible.Content class="overflow-hidden opacity-0 transition-opacity animate-collapsible-up data-expanded:animate-collapsible-down data-expanded:opacity-100">
						<div class="flex flex-col gap-2 pb-4">
							<p class="text-[11px] text-ed-text-3">
								{localize(
									"Draws a MacBook notch over the recording. Recordings made on a Mac with a notch use their own measurements; otherwise start from the size below and adjust to match.",
								)}
							</p>
							<For
								each={
									[
										{ key: "width", name: "Notch Width", max: 0.4 },
										{ key: "height", name: "Notch Height", max: 0.15 },
										{ key: "x", name: "Notch Position", max: 1 },
									] as const
								}
							>
								{(field) => {
									const notchValue = () =>
										field.key === "x"
											? Math.min(
													project.background.notch?.x ??
														editorInstance.notchBase.x,
													notchXMax(),
												)
											: (project.background.notch?.[field.key] ??
												editorInstance.notchBase[field.key]);

									return (
										<Field
											inline
											name={field.name}
											value={`${(notchValue() * 100).toFixed(1)}%`}
										>
											<Slider
												value={[notchValue()]}
												onChange={(v) => {
													const base = editorInstance.notchBase;
													const prev =
														project.background.notch ?? UNPLACED_NOTCH;
													const next: NotchConfiguration = {
														...prev,
														enabled: true,
													};
													if (field.key === "x") {
														next.x = Math.min(v[0], notchXMax());
													} else {
														next[field.key] = v[0];
													}

													if (field.key === "width") {
														// Resize about the centre rather than dragging the
														// left edge along with the width.
														const centre =
															(prev.x ?? base.x) +
															(prev.width ?? base.width) / 2;
														next.x = Math.min(
															Math.max(centre - v[0] / 2, 0),
															1 - v[0],
														);
													}

													setProject("background", "notch", next);
												}}
												minValue={0}
												maxValue={field.key === "x" ? notchXMax() : field.max}
												step={0.001}
												formatTooltip={(value) =>
													`${(value * 100).toFixed(1)}%`
												}
											/>
										</Field>
									);
								}}
							</For>
						</div>
					</KCollapsible.Content>
				</KCollapsible>
				<Show when={!selectedStyle()}>
					<ColorCorrectionSection target="screen" scrollRef={props.scrollRef} />
				</Show>
				{/* <ComingSoonTooltip>
            <Field name="Inset" icon={<IconCapInset />}>
              <Slider
                disabled
                value={[project.background.inset]}
                onChange={(v) => setProject("background", "inset", v[0])}
                minValue={0}
                maxValue={100}
              />
            </Field>
          </ComingSoonTooltip> */}
			</Show>
		</KTabs.Content>
	);
}

function CameraConfig(props: { scrollRef: HTMLDivElement }) {
	const { project, setProject, selectedStyle } = useEditorContext();
	return (
		<KTabs.Content
			value={TAB_IDS.camera}
			class="flex flex-col flex-1 gap-3.5 pt-3.5 px-4 pb-4 min-h-0"
		>
			<StyleGroupToggle group="camera" />
			<Show
				when={!selectedStyle() || selectedStyle()?.overrides.camera != null}
			>
				<CameraSettings
					camera={project.camera}
					onChange={(patch) => setProject("camera", patch)}
				/>
				<Show when={!selectedStyle()}>
					<ColorCorrectionSection target="camera" scrollRef={props.scrollRef} />
				</Show>
			</Show>
		</KTabs.Content>
	);
}

function AudioSegmentConfig(props: {
	segmentIndex: number;
	segment: AudioTrackSegment;
}) {
	const { setProject, setEditorState } = useEditorContext();
	const clampNumber = (value: number, min: number, max: number) =>
		Math.min(Math.max(Number.isFinite(value) ? value : min, min), max);

	const updateSegment = (fn: (segment: AudioTrackSegment) => void) => {
		setProject(
			"timeline",
			"audioSegments",
			produce((segments) => {
				const target = segments?.[props.segmentIndex];
				if (!target) return;
				fn(target);
			}),
		);
	};

	const segmentDuration = () =>
		Math.max(props.segment.end - props.segment.start, 0);
	const fadeMax = () => Math.max(0.1, segmentDuration());

	return (
		<div class="space-y-4">
			<Section name={`Audio ${props.segmentIndex + 1}`}>
				<div class="flex flex-col gap-3">
					<button
						type="button"
						onClick={() =>
							setEditorState("timeline", "audioReplace", props.segmentIndex)
						}
						class="flex gap-3 items-center p-2 w-full text-left rounded-xl border transition-colors group border-gray-3 bg-gray-2 hover:border-gray-5 hover:bg-gray-3"
					>
						<span
							class={cx(
								"rounded-lg ring-1 shrink-0 size-10 ring-black/10",
								AUDIO_TRACK_BG_CLASS,
							)}
						/>
						<div class="flex flex-col flex-1 min-w-0">
							<span class="text-sm font-medium truncate text-gray-12">
								{props.segment.name || "Audio"}
							</span>
							<span class="text-xs text-gray-10">
								{localize("Tap to change track")}
							</span>
						</div>
						<span class="flex gap-1 items-center px-2 h-7 text-xs font-medium rounded-lg border transition-colors shrink-0 border-gray-3 bg-gray-1 text-gray-11 group-hover:text-gray-12">
							<IconLucideRefreshCw class="size-3.5" />
							{localize("Change")}
						</span>
					</button>
					<div class="flex gap-3 items-center">
						<input
							class="flex-1 px-3 py-2 rounded-lg border border-gray-3 bg-gray-2 text-gray-12"
							value={props.segment.name ?? ""}
							placeholder={localize("Audio")}
							onInput={(e) =>
								updateSegment((segment) => {
									segment.name = e.currentTarget.value;
								})
							}
						/>
						<div class="flex flex-col gap-2 items-center">
							<span class="text-[11px] text-ed-text-3">
								{localize("Enabled")}
							</span>
							<Toggle
								checked={props.segment.enabled}
								onChange={(value) =>
									updateSegment((segment) => {
										segment.enabled = value;
									})
								}
							/>
						</div>
					</div>
				</div>
			</Section>
			<Field
				inline
				name={localize("Volume")}
				value={`${clampNumber(
					props.segment.volumeDb,
					MIN_VOLUME_DB,
					MAX_VOLUME_DB,
				).toFixed(1)} dB`}
			>
				<Slider
					value={[
						clampNumber(props.segment.volumeDb, MIN_VOLUME_DB, MAX_VOLUME_DB),
					]}
					onChange={([value]) =>
						updateSegment((segment) => {
							segment.volumeDb = clampNumber(
								value,
								MIN_VOLUME_DB,
								MAX_VOLUME_DB,
							);
						})
					}
					minValue={MIN_VOLUME_DB}
					maxValue={MAX_VOLUME_DB}
					step={1}
					formatTooltip="dB"
				/>
			</Field>
			<Field
				inline
				name="Fade In"
				value={`${clampNumber(props.segment.fadeIn, 0, fadeMax()).toFixed(2)}s`}
			>
				<Slider
					value={[clampNumber(props.segment.fadeIn, 0, fadeMax())]}
					onChange={([value]) =>
						updateSegment((segment) => {
							segment.fadeIn = clampNumber(value, 0, segmentDuration());
						})
					}
					minValue={0}
					maxValue={fadeMax()}
					step={0.05}
					formatTooltip="s"
				/>
			</Field>
			<Field
				inline
				name="Fade Out"
				value={`${clampNumber(props.segment.fadeOut, 0, fadeMax()).toFixed(2)}s`}
			>
				<Slider
					value={[clampNumber(props.segment.fadeOut, 0, fadeMax())]}
					onChange={([value]) =>
						updateSegment((segment) => {
							segment.fadeOut = clampNumber(value, 0, segmentDuration());
						})
					}
					minValue={0}
					maxValue={fadeMax()}
					step={0.05}
					formatTooltip="s"
				/>
			</Field>
		</div>
	);
}

function KeyboardSegmentConfig(props: {
	segmentIndex: number;
	segment: KeyboardTrackSegment;
}) {
	const { setProject } = useEditorContext();

	const updateSegment = (fn: (segment: KeyboardTrackSegment) => void) => {
		setProject(
			"timeline",
			"keyboardSegments",
			produce((segments) => {
				const segment = segments?.[props.segmentIndex];
				if (!segment) return;
				fn(segment);
			}),
		);
	};

	return (
		<div class="space-y-4">
			<Section name={`Keyboard ${props.segmentIndex + 1}`}>
				<Input
					type="text"
					value={props.segment.displayText}
					onChange={(e) =>
						updateSegment((segment) => {
							segment.displayText = e.currentTarget.value;
						})
					}
				/>
			</Section>
			<Field name="Timing">
				<div class="rounded-xl bg-ed-card-2 p-3 space-y-3">
					<div class="grid grid-cols-[1fr_auto_1fr] gap-2 items-start">
						<div class="rounded-lg bg-ed-card p-2.5 space-y-2">
							<div class="flex items-center justify-between text-[10px] uppercase tracking-[0.08em] text-ed-text-3">
								<span>{localize("Start")}</span>
								<span>{formatTime(props.segment.start)}</span>
							</div>
							<Input
								type="number"
								value={props.segment.start.toFixed(2)}
								step="0.1"
								min={0}
								onChange={(e) =>
									updateSegment((segment) => {
										segment.start = Number.parseFloat(e.currentTarget.value);
									})
								}
							/>
						</div>
						<div class="pt-10 text-[11px] font-medium text-ed-text-3">
							{localize("to")}
						</div>
						<div class="rounded-lg bg-ed-card p-2.5 space-y-2">
							<div class="flex items-center justify-between text-[10px] uppercase tracking-[0.08em] text-ed-text-3">
								<span>{localize("End")}</span>
								<span>{formatTime(props.segment.end)}</span>
							</div>
							<Input
								type="number"
								value={props.segment.end.toFixed(2)}
								step="0.1"
								min={props.segment.start}
								onChange={(e) =>
									updateSegment((segment) => {
										segment.end = Number.parseFloat(e.currentTarget.value);
									})
								}
							/>
						</div>
					</div>
					<div class="flex items-center justify-between rounded-lg bg-ed-card px-3 py-2 text-[11px] text-ed-text-2">
						<span>{localize("Duration")}</span>
						<span class="font-medium text-ed-text-1">
							{Math.max(0, props.segment.end - props.segment.start).toFixed(2)}s
						</span>
					</div>
				</div>
			</Field>
			<Field
				inline
				name="Fade Duration"
				value={Math.round((props.segment.fadeDurationOverride ?? 0.15) * 100)}
			>
				<Slider
					value={[(props.segment.fadeDurationOverride ?? 0.15) * 100]}
					onChange={([value]) =>
						updateSegment((segment) => {
							segment.fadeDurationOverride = value / 100;
						})
					}
					minValue={0}
					maxValue={50}
					step={1}
				/>
			</Field>
		</div>
	);
}

function CaptionSegmentConfig(props: {
	segmentIndex: number;
	segment: CaptionTrackSegment;
}) {
	const { setProject } = useEditorContext();

	const updateSegment = (fn: (segment: CaptionTrackSegment) => void) => {
		setProject(
			produce((project) => {
				const timelineSegment =
					project.timeline?.captionSegments?.[props.segmentIndex];
				if (!timelineSegment) return;

				fn(timelineSegment);

				const captionSegment = project.captions?.segments?.[props.segmentIndex];
				if (!captionSegment) return;

				captionSegment.start = timelineSegment.start;
				captionSegment.end = timelineSegment.end;
				captionSegment.text = timelineSegment.text;
				captionSegment.words = timelineSegment.words?.map((word) => ({
					...word,
				}));
			}),
		);
	};

	return (
		<div class="space-y-4">
			<Section name={`Caption ${props.segmentIndex + 1}`}>
				<textarea
					class="flex-1 px-3 py-2 rounded-lg border border-gray-3 bg-gray-2 text-gray-12 resize-none min-h-[96px] w-full"
					value={props.segment.text}
					onInput={(e) =>
						updateSegment((segment) => {
							segment.text = e.currentTarget.value;
							segment.words = syncCaptionWordsWithText(
								e.currentTarget.value,
								segment.words,
								segment.start,
								segment.end,
							);
						})
					}
				/>
			</Section>
			<Field name="Timing">
				<div class="rounded-xl bg-ed-card-2 p-3 space-y-3">
					<div class="grid grid-cols-[1fr_auto_1fr] gap-2 items-start">
						<div class="rounded-lg bg-ed-card p-2.5 space-y-2">
							<div class="flex items-center justify-between text-[10px] uppercase tracking-[0.08em] text-ed-text-3">
								<span>{localize("Start")}</span>
								<span>{formatTime(props.segment.start)}</span>
							</div>
							<Input
								type="number"
								value={props.segment.start.toFixed(2)}
								step="0.1"
								min={0}
								onChange={(
									e: Event & {
										currentTarget: HTMLInputElement;
										target: HTMLInputElement;
									},
								) =>
									updateSegment((segment) => {
										segment.start = Number.parseFloat(e.target.value);
									})
								}
							/>
						</div>
						<div class="pt-10 text-[11px] font-medium text-ed-text-3">
							{localize("to")}
						</div>
						<div class="rounded-lg bg-ed-card p-2.5 space-y-2">
							<div class="flex items-center justify-between text-[10px] uppercase tracking-[0.08em] text-ed-text-3">
								<span>{localize("End")}</span>
								<span>{formatTime(props.segment.end)}</span>
							</div>
							<Input
								type="number"
								value={props.segment.end.toFixed(2)}
								step="0.1"
								min={props.segment.start}
								onChange={(
									e: Event & {
										currentTarget: HTMLInputElement;
										target: HTMLInputElement;
									},
								) =>
									updateSegment((segment) => {
										segment.end = Number.parseFloat(e.target.value);
									})
								}
							/>
						</div>
					</div>
					<div class="flex items-center justify-between rounded-lg bg-ed-card px-3 py-2 text-[11px] text-ed-text-2">
						<span>{localize("Duration")}</span>
						<span class="font-medium text-ed-text-1">
							{Math.max(0, props.segment.end - props.segment.start).toFixed(2)}s
						</span>
					</div>
				</div>
			</Field>
		</div>
	);
}

function MaskSegmentConfig(props: {
	segmentIndex: number;
	segment: MaskSegment;
}) {
	const { setProject } = useEditorContext();

	const updateSegment = (fn: (segment: MaskSegment) => void) => {
		setProject(
			"timeline",
			"maskSegments",
			produce((segments) => {
				const target = segments?.[props.segmentIndex];
				if (!target) return;
				target.keyframes ??= { position: [], size: [], intensity: [] };
				fn(target);
			}),
		);
	};

	createEffect(() => {
		const keyframes = props.segment.keyframes;
		if (
			!keyframes ||
			(keyframes.position.length === 0 &&
				keyframes.size.length === 0 &&
				keyframes.intensity.length === 0)
		)
			return;
		updateSegment((segment) => {
			segment.keyframes = { position: [], size: [], intensity: [] };
		});
	});

	const maskEffect = () => getMaskEffect(props.segment);
	const maskEffectAmount = () => getMaskEffectAmount(props.segment);

	const setMaskEffect = (effect: MaskEffect) =>
		updateSegment((segment) => {
			segment.pixelation = encodeMaskEffect(
				effect,
				getMaskEffectAmount(segment),
			);
			segment.opacity = 1;
			segment.keyframes.intensity = [];
		});

	const setMaskEffectAmount = (amount: number) =>
		updateSegment((segment) => {
			segment.pixelation = encodeMaskEffect(getMaskEffect(segment), amount);
			segment.opacity = 1;
			segment.keyframes.intensity = [];
		});

	return (
		<div class="space-y-4">
			<Section name={`Mask ${props.segmentIndex + 1}`}>
				<div class="flex items-center justify-between gap-4">
					<RadioGroup
						class="grid grid-cols-2 gap-2"
						value={props.segment.maskType}
						onChange={(value) =>
							updateSegment((segment) => {
								segment.maskType = value as MaskKind;
								if (segment.maskType === "highlight") {
									segment.feather = 0;
									segment.opacity = 1;
								} else {
									segment.feather = 0.1;
									segment.fadeDuration = 0;
								}
							})
						}
					>
						{[
							{ value: "sensitive", label: "Sensitive" },
							{ value: "highlight", label: "Highlight" },
						].map((option) => (
							<RadioGroup.Item
								value={option.value}
								class="rounded-lg border border-gray-3 transition-colors data-checked:border-blue-8 data-checked:bg-blue-3/40"
							>
								<RadioGroup.ItemInput class="sr-only" />
								<RadioGroup.ItemLabel class="flex items-center gap-2 p-2 text-[13px] text-ed-text-1">
									<RadioGroup.ItemControl class="size-4 rounded-full border border-gray-7 data-checked:border-blue-9 data-checked:bg-blue-9" />
									{localize(option.label)}
								</RadioGroup.ItemLabel>
							</RadioGroup.Item>
						))}
					</RadioGroup>
					<div class="flex items-center gap-2">
						<span class="text-[11px] text-ed-text-3">
							{localize("Enabled")}
						</span>
						<Toggle
							checked={props.segment.enabled}
							onChange={(value) =>
								updateSegment((segment) => {
									segment.enabled = value;
								})
							}
						/>
					</div>
				</div>
			</Section>
			<Show when={props.segment.maskType === "sensitive"}>
				<Field name="Effect">
					<RadioGroup
						class="grid grid-cols-2 gap-2"
						value={maskEffect()}
						onChange={(value) => setMaskEffect(value as MaskEffect)}
					>
						{[
							{ value: "blur", label: "Blur" },
							{ value: "pixelate", label: "Pixelate" },
						].map((option) => (
							<RadioGroup.Item
								value={option.value}
								class="rounded-lg border border-gray-3 transition-colors data-checked:border-blue-8 data-checked:bg-blue-3/40"
							>
								<RadioGroup.ItemInput class="sr-only" />
								<RadioGroup.ItemLabel class="flex items-center gap-2 p-2 text-[13px] text-ed-text-1">
									<RadioGroup.ItemControl class="size-4 rounded-full border border-gray-7 data-checked:border-blue-9 data-checked:bg-blue-9" />
									{localize(option.label)}
								</RadioGroup.ItemLabel>
							</RadioGroup.Item>
						))}
					</RadioGroup>
				</Field>
			</Show>
			<Show when={props.segment.maskType === "sensitive"}>
				<Field
					inline
					name={
						maskEffect() === "blur"
							? localize("模糊强度")
							: localize("像素大小")
					}
					value={`${Math.round(maskEffectAmount())}px`}
				>
					<Slider
						value={[maskEffectAmount()]}
						onChange={([v]) => setMaskEffectAmount(v)}
						minValue={4}
						maxValue={80}
						step={1}
						formatTooltip="px"
					/>
				</Field>
			</Show>
			<Show when={props.segment.maskType === "highlight"}>
				<Field
					inline
					name="Outside Darkness"
					value={`${Math.round(props.segment.darkness * 100)}%`}
				>
					<Slider
						value={[props.segment.darkness]}
						onChange={([v]) =>
							updateSegment((segment) => {
								segment.darkness = v;
							})
						}
						minValue={0}
						maxValue={1}
						step={0.01}
					/>
				</Field>
			</Show>
			<Show when={props.segment.maskType === "highlight"}>
				<Field
					inline
					name="Fade Duration"
					value={`${(props.segment.fadeDuration ?? 0.15).toFixed(2)}s`}
				>
					<Slider
						value={[props.segment.fadeDuration ?? 0.15]}
						onChange={([v]) =>
							updateSegment((segment) => {
								segment.fadeDuration = v;
							})
						}
						minValue={0}
						maxValue={1}
						step={0.01}
						formatTooltip="s"
					/>
				</Field>
			</Show>
		</div>
	);
}

// Maps a zoom segment's start (held-output time on the edited timeline) to
// the recording-segment file and the time within it whose frame is on screen
// at that moment. Split/trimmed timelines mean neither can be read off the
// zoom segment directly.
function zoomPreviewSource(
	timeline:
		| {
				segments: TimelineSegment[];
				transitions?: ClipTransition[];
				textSegments?: TextSegment[];
		  }
		| null
		| undefined,
	editedTime: number,
): { recordingSegment: number; sourceTime: number } {
	const gapless =
		editedTime -
		heldTimeBefore(holdWindows(timeline?.textSegments), editedTime);
	return (
		clipSourceTimeAt(
			timeline?.segments ?? [],
			timeline?.transitions ?? [],
			gapless,
		) ?? { recordingSegment: 0, sourceTime: gapless }
	);
}

// The mapping memos return fresh objects; compare by value so unrelated
// timeline edits don't restart the preview <video>.
const zoomPreviewSourceEquals = (
	a: { recordingSegment: number; sourceTime: number },
	b: { recordingSegment: number; sourceTime: number },
) => a.recordingSegment === b.recordingSegment && a.sourceTime === b.sourceTime;

function ZoomSegmentPreview(props: {
	segmentIndex: number;
	segment: ZoomSegment;
}) {
	const { project, editorInstance } = useEditorContext();

	const source = createMemo(
		() => zoomPreviewSource(project.timeline, props.segment.start),
		undefined,
		{ equals: zoomPreviewSourceEquals },
	);

	const video = document.createElement("video");
	createEffect(() => {
		const path = convertFileSrc(
			`${editorInstance.path}/content/segments/segment-${
				source().recordingSegment
			}/display.mp4`,
		);
		video.src = path;
		video.preload = "auto";
		video.load();
	});

	createEffect(() => {
		const t = source().sourceTime;

		if (video.readyState >= 2) {
			video.currentTime = t;
		} else {
			const handleCanPlay = () => {
				video.currentTime = t;
				video.removeEventListener("canplay", handleCanPlay);
			};
			video.addEventListener("canplay", handleCanPlay);
		}
	});

	const render = () => {
		if (!canvasRef || video.readyState < 2) return;

		const ctx = canvasRef.getContext("2d");
		if (!ctx) return;

		ctx.imageSmoothingEnabled = false;
		ctx.clearRect(0, 0, canvasRef.width, canvasRef.height);

		const raw = (
			editorInstance.recordings.segments[source().recordingSegment] ??
			editorInstance.recordings.segments[0]
		).display;
		const croppedPosition = project.background.crop?.position || { x: 0, y: 0 };
		const croppedSize = project.background.crop?.size || {
			x: raw.width,
			y: raw.height,
		};

		ctx.drawImage(
			video,
			croppedPosition.x,
			croppedPosition.y,
			croppedSize.x,
			croppedSize.y,
			0,
			0,
			canvasRef.width,
			canvasRef.height,
		);
	};

	const [loaded, setLoaded] = createSignal(false);
	video.onloadeddata = () => {
		setLoaded(true);
		render();
	};
	video.onseeked = render;
	video.onerror = () => {
		setTimeout(() => video.load(), 100);
	};

	let canvasRef!: HTMLCanvasElement;

	return (
		<>
			<div class="space-y-1.5">
				<div class="text-xs font-medium text-center text-gray-12">
					{localize("Zoom")} {props.segmentIndex + 1}
				</div>
				<div class="overflow-hidden relative rounded-sm border aspect-video border-gray-3 bg-gray-3">
					<canvas
						ref={canvasRef}
						width={160}
						height={90}
						data-loaded={loaded()}
						class="w-full h-full opacity-0 transition-opacity data-[loaded='true']:opacity-100 duration-200"
					/>
					<Show when={!loaded()}>
						<p class="flex absolute inset-0 justify-center items-center text-xs text-gray-11">
							{localize("Loading...")}
						</p>
					</Show>
				</div>
			</div>
			<div class="flex gap-1 justify-center items-center mt-3 w-full text-xs text-center text-gray-11">
				<IconLucideSearch class="size-3" />
				<p>{props.segment.amount.toFixed(1)}x</p>
			</div>
		</>
	);
}

function ZoomSegmentConfig(props: {
	segmentIndex: number;
	segment: ZoomSegment;
}) {
	const generalSettings = generalSettingsStore.createQuery();
	const { project, setProject, editorInstance, projectHistory } =
		useEditorContext();

	const states = {
		manual:
			props.segment.mode === "auto"
				? { x: 0.5, y: 0.5 }
				: props.segment.mode.manual,
	};

	return (
		<>
			<Field
				inline
				name={`Zoom ${props.segmentIndex + 1}`}
				value={`${props.segment.amount.toFixed(2)}x`}
			>
				<Slider
					value={[props.segment.amount]}
					onChange={(v) =>
						setProject(
							"timeline",
							"zoomSegments",
							props.segmentIndex,
							"amount",
							v[0],
						)
					}
					minValue={1}
					maxValue={4.5}
					step={0.001}
					formatTooltip="x"
				/>
			</Field>
			<Field name="Zoom Mode">
				<KTabs
					class="space-y-6"
					value={props.segment.mode === "auto" ? "auto" : "manual"}
					onChange={(v) => {
						setProject(
							"timeline",
							"zoomSegments",
							props.segmentIndex,
							"mode",
							v === "auto" ? "auto" : { manual: states.manual },
						);
					}}
				>
					<KTabs.List class="flex flex-row relative gap-0.5 items-center p-0.5 rounded-lg bg-ed-ctl">
						<KTabs.Trigger
							value="auto"
							class="z-10 flex-1 h-[26px] rounded-md text-[11.5px] font-medium text-ed-text-2 transition-colors duration-100 outline-hidden data-selected:text-ed-text-1 peer"
							disabled={!generalSettings.data?.custom_cursor_capture2}
						>
							{localize("Auto")}
						</KTabs.Trigger>
						<KTabs.Trigger
							value="manual"
							class="z-10 flex-1 h-[26px] rounded-md text-[11.5px] font-medium text-ed-text-2 transition-colors duration-100 outline-hidden data-selected:text-ed-text-1 peer"
						>
							{localize("Manual")}
						</KTabs.Trigger>
						<KTabs.Indicator class="flex overflow-hidden absolute inset-y-0.5 left-0 rounded-md transition-transform">
							<div class="flex-1 bg-ed-card dark:bg-white/11 shadow-[0_1px_2px_rgba(0,0,0,.12),0_0_0_.5px_rgba(0,0,0,.06)] dark:shadow-none" />
						</KTabs.Indicator>
					</KTabs.List>
					<div class="space-y-3">
						<Show when={!generalSettings.data?.custom_cursor_capture2}>
							<p class="text-[11px] text-ed-text-3">
								{localize(
									'Auto mode needs cursor capture. Enable "Custom cursor capture (Studio)" in Settings → General.',
								)}
							</p>
						</Show>
						<ZoomModeHelper
							mode={props.segment.mode === "auto" ? "auto" : "manual"}
						/>
					</div>
					<KTabs.Content value="manual" tabIndex="">
						<Show
							when={(() => {
								const m = props.segment.mode;
								if (m === "auto") return;

								return m.manual;
							})()}
						>
							{(mode) => {
								// Frozen while history is paused so drags don't thrash the
								// <video> seek.
								const source = createMemo<{
									recordingSegment: number;
									sourceTime: number;
								}>(
									(prev) => {
										if (projectHistory.isPaused()) return prev;

										return zoomPreviewSource(
											project.timeline,
											props.segment.start,
										);
									},
									{ recordingSegment: 0, sourceTime: 0 },
									{ equals: zoomPreviewSourceEquals },
								);

								const video = document.createElement("video");
								createEffect(() => {
									const path = convertFileSrc(
										`${editorInstance.path}/content/segments/segment-${
											source().recordingSegment
										}/display.mp4`,
									);
									video.src = path;
									video.preload = "auto";
									// Force reload if video fails to load
									video.load();
								});

								createEffect(() => {
									const t = source().sourceTime;

									// Ensure video is ready before seeking
									if (video.readyState >= 2) {
										video.currentTime = t;
									} else {
										// Wait for video to be ready, then seek
										const handleCanPlay = () => {
											video.currentTime = t;
											video.removeEventListener("canplay", handleCanPlay);
										};
										video.addEventListener("canplay", handleCanPlay);
									}
								});

								createEffect(
									on(
										() => {
											croppedPosition();
											croppedSize();
										},
										() => {
											if (loaded()) {
												render();
											}
										},
									),
								);

								const render = () => {
									if (!canvasRef || video.readyState < 2) return;

									const ctx = canvasRef.getContext("2d");
									if (!ctx) return;

									ctx.imageSmoothingEnabled = false;
									// Clear canvas first
									ctx.clearRect(0, 0, canvasRef.width, canvasRef.height);
									// Draw video frame
									ctx.drawImage(
										video,
										croppedPosition().x,
										croppedPosition().y,
										croppedSize().x,
										croppedSize().y,
										0,
										0,
										canvasRef.width,
										canvasRef.height,
									);
								};

								const [loaded, setLoaded] = createSignal(false);
								video.onloadeddata = () => {
									setLoaded(true);
									render();
								};
								video.onseeked = render;

								// Add error handling
								video.onerror = (e) => {
									console.error("Failed to load video for zoom preview:", e);
									// Try to reload after a short delay
									setTimeout(() => {
										video.load();
									}, 100);
								};

								let canvasRef!: HTMLCanvasElement;

								const [ref, setRef] = createSignal<HTMLDivElement>();
								const bounds = createElementBounds(ref);
								const rawSize = () => {
									const raw = (
										editorInstance.recordings.segments[
											source().recordingSegment
										] ?? editorInstance.recordings.segments[0]
									).display;
									return { x: raw.width, y: raw.height };
								};

								const croppedPosition = () => {
									const cropped = project.background.crop?.position;
									if (cropped) return cropped;

									return { x: 0, y: 0 };
								};

								const croppedSize = () => {
									const cropped = project.background.crop?.size;
									if (cropped) return cropped;

									return rawSize();
								};

								const visualHeight = () =>
									((bounds.width ?? 0) / croppedSize().x) * croppedSize().y;

								return (
									<div
										ref={setRef}
										class="relative w-full"
										style={{
											height: `calc(${visualHeight()}px + 0.25rem)`,
										}}
										onMouseDown={(downEvent) => {
											const bounds =
												downEvent.currentTarget.getBoundingClientRect();

											createRoot((dispose) =>
												createEventListenerMap(window, {
													mouseup: () => dispose(),
													mousemove: (moveEvent) => {
														setProject(
															"timeline",
															"zoomSegments",
															props.segmentIndex,
															"mode",
															"manual",
															{
																x: Math.max(
																	Math.min(
																		(moveEvent.clientX - bounds.left) /
																			bounds.width,
																		1,
																	),
																	0,
																),
																y: Math.max(
																	Math.min(
																		(moveEvent.clientY - bounds.top) /
																			bounds.height,
																		1,
																	),
																	0,
																),
															},
														);
													},
												}),
											);
										}}
									>
										<div
											class="absolute z-10 w-6 h-6 rounded-full border border-gray-400 -translate-x-1/2 -translate-y-1/2 bg-gray-1"
											style={{
												left: `${mode().x * 100}%`,
												top: `${mode().y * 100}%`,
											}}
										>
											<div class="size-1.5 bg-gray-5 rounded-full" />
										</div>
										<div class="overflow-hidden relative rounded-lg border border-gray-3 bg-gray-2">
											<canvas
												ref={canvasRef}
												width={croppedSize().x}
												height={croppedSize().y}
												data-loaded={loaded()}
												class="z-10 bg-gray-3 opacity-0 transition-opacity data-[loaded='true']:opacity-100 w-full h-full duration-200"
											/>
											<Show when={!loaded()}>
												<div class="flex absolute inset-0 justify-center items-center bg-gray-2">
													<div class="text-sm text-gray-11">
														{localize("Loading preview...")}
													</div>
												</div>
											</Show>
										</div>
									</div>
								);
							}}
						</Show>
					</KTabs.Content>
				</KTabs>
			</Field>
		</>
	);
}

// Bulk editor shown when multiple zoom segments are selected: one set of
// controls that writes to every selected segment, with "Mixed" badges when
// the selected segments' values differ.
function ZoomMultiSegmentConfig(props: {
	segments: { index: number; segment: ZoomSegment }[];
}) {
	const generalSettings = generalSettingsStore.createQuery();
	const { setProject, setEditorState } = useEditorContext();

	const amounts = () => props.segments.map((s) => s.segment.amount);
	const sharedAmount = () => {
		const [first, ...rest] = amounts();
		if (first === undefined) return null;
		return rest.every((a) => a === first) ? first : null;
	};
	const averageAmount = () => {
		const values = amounts();
		if (values.length === 0) return 1;
		return values.reduce((sum, v) => sum + v, 0) / values.length;
	};

	const sharedMode = (): "auto" | "manual" | "mixed" => {
		const modes = props.segments.map((s) =>
			s.segment.mode === "auto" ? ("auto" as const) : ("manual" as const),
		);
		const [first, ...rest] = modes;
		if (first === undefined) return "mixed";
		return rest.every((m) => m === first) ? first : "mixed";
	};

	const manualPositions = () =>
		props.segments.map((s) =>
			s.segment.mode === "auto" ? { x: 0.5, y: 0.5 } : s.segment.mode.manual,
		);

	const manualPositionsMixed = () => {
		const [first, ...rest] = manualPositions();
		if (!first) return false;
		return rest.some((p) => p.x !== first.x || p.y !== first.y);
	};

	const averageManualPosition = () => {
		const positions = manualPositions();
		if (positions.length === 0) return { x: 0.5, y: 0.5 };
		return {
			x: positions.reduce((sum, p) => sum + p.x, 0) / positions.length,
			y: positions.reduce((sum, p) => sum + p.y, 0) / positions.length,
		};
	};

	const setAllAmounts = (amount: number) =>
		batch(() => {
			for (const { index } of props.segments)
				setProject("timeline", "zoomSegments", index, "amount", amount);
		});

	// Switching to manual keeps each segment's existing focal point; only
	// segments coming from auto get the centered default.
	const setAllModes = (mode: "auto" | "manual") =>
		batch(() => {
			for (const { index, segment } of props.segments) {
				if (mode === "auto")
					setProject("timeline", "zoomSegments", index, "mode", "auto");
				else if (segment.mode === "auto")
					setProject("timeline", "zoomSegments", index, "mode", {
						manual: { x: 0.5, y: 0.5 },
					});
			}
		});

	const setAllManualPositions = (pos: XY<number>) =>
		batch(() => {
			for (const { index } of props.segments)
				setProject("timeline", "zoomSegments", index, "mode", {
					manual: { ...pos },
				});
		});

	const removeFromSelection = (segmentIndex: number) => {
		const remaining = props.segments
			.map((s) => s.index)
			.filter((index) => index !== segmentIndex);
		setEditorState(
			"timeline",
			"selection",
			remaining.length > 0 ? { type: "zoom", indices: remaining } : null,
		);
	};

	const modeButtonClass =
		"flex-1 h-[26px] rounded-md text-[11.5px] font-medium text-ed-text-2 transition-colors duration-100 outline-hidden data-[selected='true']:bg-ed-card data-[selected='true']:text-ed-text-1 data-[selected='true']:shadow-[0_1px_2px_rgba(0,0,0,.12),0_0_0_.5px_rgba(0,0,0,.06)] dark:data-[selected='true']:bg-white/11 dark:data-[selected='true']:shadow-none not-data-[selected='true']:hover:text-ed-text-1 disabled:opacity-40 disabled:cursor-not-allowed";

	return (
		<div class="space-y-4">
			<div class="flex flex-col gap-3.5 p-4 rounded-xl bg-ed-card-2">
				<Field
					inline
					name={localize("缩放幅度")}
					badge={sharedAmount() === null ? localize("数值不一") : undefined}
					value={`${(sharedAmount() ?? averageAmount()).toFixed(2)}x`}
				>
					<Slider
						value={[sharedAmount() ?? averageAmount()]}
						onChange={(v) => setAllAmounts(v[0])}
						minValue={1}
						maxValue={4.5}
						step={0.001}
						formatTooltip="x"
					/>
				</Field>
				<Field
					name={localize("缩放方式")}
					badge={sharedMode() === "mixed" ? localize("选项不一") : undefined}
				>
					<div class="flex flex-row gap-0.5 items-center p-0.5 rounded-lg bg-ed-ctl">
						<button
							type="button"
							disabled={!generalSettings.data?.custom_cursor_capture2}
							data-selected={sharedMode() === "auto"}
							onClick={() => setAllModes("auto")}
							class={modeButtonClass}
						>
							{localize("Auto")}
						</button>
						<button
							type="button"
							data-selected={sharedMode() === "manual"}
							onClick={() => setAllModes("manual")}
							class={modeButtonClass}
						>
							{localize("Manual")}
						</button>
					</div>
					<Show when={!generalSettings.data?.custom_cursor_capture2}>
						<p class="text-[11px] text-ed-text-3">
							{localize(
								'Auto mode needs cursor capture. Enable "Custom cursor capture (Studio)" in Settings → General.',
							)}
						</p>
					</Show>
					<Show
						when={(() => {
							const mode = sharedMode();
							return mode === "mixed" ? null : mode;
						})()}
					>
						{(mode) => <ZoomModeHelper mode={mode()} />}
					</Show>
					<Show when={sharedMode() === "manual"}>
						<div class="space-y-1.5">
							<PositionPad
								value={averageManualPosition}
								onChange={setAllManualPositions}
							/>
							<Show when={manualPositionsMixed()}>
								<p class="text-xs text-gray-10">
									{localize(
										"Segments zoom into different spots. Drag to move them all to the same one.",
									)}
								</p>
							</Show>
						</div>
					</Show>
				</Field>
			</div>
			<div class="grid grid-cols-3 gap-4">
				<Index each={[...props.segments].sort((a, b) => a.index - b.index)}>
					{(item) => (
						<div class="relative p-2.5 rounded-lg border border-gray-4 bg-gray-3 group">
							<button
								type="button"
								class="hidden absolute top-1.5 right-1.5 z-10 justify-center items-center rounded-full transition-colors group-hover:flex bg-gray-5 hover:bg-gray-6 text-gray-11 hover:text-gray-12 size-5"
								aria-label={localize("Remove from selection")}
								onClick={() => removeFromSelection(item().index)}
							>
								<IconLucideX class="size-3" />
							</button>
							<ZoomSegmentPreview
								segment={item().segment}
								segmentIndex={item().index}
							/>
						</div>
					)}
				</Index>
			</div>
		</div>
	);
}

// A/V sync offsets are per recording segment (project.clips is keyed by
// recording segment index), so they live with the audio settings rather
// than any one timeline segment.
function SyncOffsetsConfig() {
	const { project, setProject, editorInstance, meta } = useEditorContext();

	const clipConfig = (recordingIndex: number) =>
		project.clips?.find((c) => c.index === recordingIndex);

	const hasAnySource = () =>
		meta().hasSystemAudio || meta().hasMicrophone || meta().hasCamera;

	function setOffset(
		recordingIndex: number,
		type: keyof ClipOffsets,
		offsetMs: number,
	) {
		if (Number.isNaN(offsetMs)) return;

		setProject(
			produce((proj) => {
				if (!proj.clips) proj.clips = [];
				let clip = proj.clips.find((c) => c.index === recordingIndex);
				if (!clip) {
					clip = { index: recordingIndex, offsets: {} };
					proj.clips.push(clip);
				}

				clip.offsets[type] = offsetMs / 1000;
				clip.offsetsAutoCalculated = false;
			}),
		);
	}

	return (
		<Show when={hasAnySource()}>
			<div class="flex flex-col gap-3.5">
				<Section name="Sync">
					<p class="text-[11px] text-ed-text-3">
						{localize(
							"Fine-tune source offsets if audio or camera drifts out of sync with the screen recording.",
						)}
					</p>
				</Section>

				<For each={editorInstance.recordings.segments}>
					{(_, index) => (
						<div class="flex flex-col gap-3.5">
							<Show when={editorInstance.recordings.segments.length > 1}>
								<SectionLabel name={`Clip ${index()}`} />
							</Show>
							<Show when={clipConfig(index())?.offsetsAutoCalculated === true}>
								<p class="text-[11px] text-ed-text-3">
									{localize(
										"These offsets were calculated automatically to keep audio in sync with the video. Adjust them if anything still sounds off.",
									)}
								</p>
							</Show>
							{meta().hasSystemAudio && (
								<SourceOffsetField
									name="System Audio Offset"
									value={clipConfig(index())?.offsets.system_audio}
									autoCalculated={
										clipConfig(index())?.offsetsAutoCalculated === true
									}
									onChange={(offset) => {
										setOffset(index(), "system_audio", offset);
									}}
								/>
							)}
							{meta().hasMicrophone && (
								<SourceOffsetField
									name="Microphone Offset"
									value={clipConfig(index())?.offsets.mic}
									autoCalculated={
										clipConfig(index())?.offsetsAutoCalculated === true
									}
									onChange={(offset) => {
										setOffset(index(), "mic", offset);
									}}
								/>
							)}
							{meta().hasCamera && (
								<SourceOffsetField
									name="Camera Offset"
									value={clipConfig(index())?.offsets.camera}
									autoCalculated={
										clipConfig(index())?.offsetsAutoCalculated === true
									}
									onChange={(offset) => {
										setOffset(index(), "camera", offset);
									}}
								/>
							)}
						</div>
					)}
				</For>
			</div>
		</Show>
	);
}

function SourceOffsetField(props: {
	name: string;
	// seconds
	value?: number;
	autoCalculated?: boolean;
	onChange: (value: number) => void;
}) {
	const rawValue = () => Math.round((props.value ?? 0) * 1000);

	const [value, setValue] = createSignal(rawValue().toString());

	return (
		<Field
			name={props.name}
			badge={props.autoCalculated ? localize("自动同步") : undefined}
		>
			<div class="flex flex-row justify-between items-center -mt-2 w-full">
				<div class="flex flex-row items-end space-x-1">
					<NumberField.Root
						value={value()}
						onChange={setValue}
						rawValue={rawValue()}
						onRawValueChange={(v) => {
							props.onChange(v);
						}}
					>
						<NumberField.Input
							onBlur={() => {
								if (!rawValue() || value() === "" || Number.isNaN(rawValue())) {
									setValue("0");
									props.onChange(0);
								}
							}}
							class="w-20 p-1.5 border rounded-lg bg-gray-1 focus-visible:outline-hidden"
						/>
					</NumberField.Root>
					<span class="text-gray-11">ms</span>
				</div>
				<div class="flex flex-row space-x-1 text-gray-11">
					{[-100, -10, 10, 100].map((v) => (
						<button
							type="button"
							onClick={() => {
								const currentValue = rawValue() + v;
								props.onChange(currentValue);
								setValue(currentValue.toString());
							}}
							class="text-gray-11 hover:text-gray-12 text-xs px-1 py-0.5 bg-gray-1 border border-gray-3 rounded-sm"
						>
							{Math.sign(v) > 0 ? "+" : "-"}
							{Math.abs(v)}ms
						</button>
					))}
				</div>
			</div>
		</Field>
	);
}

const SCENE_MODE_TRIGGER_CLASS =
	"flex gap-1.5 justify-center items-center h-[30px] px-2 text-[11.5px] font-medium whitespace-nowrap text-ed-text-2 rounded-lg bg-ed-ctl transition-colors duration-200 outline-hidden data-selected:bg-ed-ctl-hover data-selected:text-ed-text-1 not-data-selected:hover:text-ed-text-1 disabled:opacity-40 disabled:cursor-not-allowed";

// 2D drag pad for a normalized focal point (mirrors the manual-zoom position
// picker): click/drag anywhere to set {x,y} in 0..1, pausing history so the
// whole drag is one undo step.
function PositionPad(props: {
	value: () => XY<number>;
	onChange: (pos: XY<number>) => void;
}) {
	const { projectHistory } = useEditorContext();

	const onPick = (downEvent: MouseEvent) => {
		downEvent.preventDefault();
		const bounds = downEvent.currentTarget as HTMLElement;
		const rect = bounds.getBoundingClientRect();
		const resumeHistory = projectHistory.pause();
		const apply = (e: MouseEvent) => {
			props.onChange({
				x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
				y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
			});
		};
		apply(downEvent);
		createRoot((dispose) =>
			createEventListenerMap(window, {
				mousemove: apply,
				mouseup: () => {
					resumeHistory();
					dispose();
				},
			}),
		);
	};

	return (
		<div
			class="overflow-hidden relative w-full h-28 rounded-lg border border-gray-3 bg-gray-2 cursor-crosshair"
			onMouseDown={onPick}
		>
			<div class="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-gray-3 pointer-events-none" />
			<div class="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-gray-3 pointer-events-none" />
			<div
				class="flex absolute z-10 justify-center items-center w-6 h-6 rounded-full border border-gray-400 -translate-x-1/2 -translate-y-1/2 bg-gray-1 pointer-events-none"
				style={{
					left: `${props.value().x * 100}%`,
					top: `${props.value().y * 100}%`,
				}}
			>
				<div class="rounded-full size-1.5 bg-gray-5" />
			</div>
		</div>
	);
}

function SceneSegmentConfig(props: {
	segmentIndex: number;
	segment: SceneSegment;
}) {
	const { setProject, setEditorState, projectActions, editorInstance } =
		useEditorContext();

	const hasCamera = () =>
		!editorInstance.recordings.segments.every((s) => s.camera === null);

	const description = () => {
		switch (props.segment.mode) {
			case "cameraOnly":
				return "Shows only the camera feed";
			case "hideCamera":
				return "Shows only the screen recording";
			case "splitScreen":
				return "Screen and camera side by side (auto-stacks in portrait)";
			case "floating":
				return "Screen and camera float side by side as rounded cards over the background";
			default:
				return "Shows both screen and camera";
		}
	};

	const split = () => props.segment.splitLayout ?? DEFAULT_SPLIT_LAYOUT;
	const updateSplit = (patch: Partial<SplitLayout>) =>
		setProject("timeline", "sceneSegments", props.segmentIndex, "splitLayout", {
			...split(),
			...patch,
		});

	return (
		<>
			<div class="flex flex-row justify-between items-center">
				<div class="flex gap-2 items-center">
					<EditorButton
						onClick={() => setEditorState("timeline", "selection", null)}
						leftIcon={<IconLucideCheck />}
					>
						{localize("Done")}
					</EditorButton>
				</div>
				<EditorButton
					variant="danger"
					onClick={() => {
						projectActions.deleteSceneSegment(props.segmentIndex);
					}}
					leftIcon={<IconCapTrash />}
				>
					{localize("Delete")}
				</EditorButton>
			</div>
			<Field name="Camera Layout">
				<KTabs
					class="space-y-3"
					value={props.segment.mode || "default"}
					onChange={(v) => {
						const mode = v as SceneMode;
						batch(() => {
							setProject(
								"timeline",
								"sceneSegments",
								props.segmentIndex,
								"mode",
								mode,
							);
							// Seed identity overrides so the new split segment renders
							// correctly and the fine-tune controls have values to bind to.
							if (
								(mode === "splitScreen" || mode === "floating") &&
								!props.segment.splitLayout
							)
								setProject(
									"timeline",
									"sceneSegments",
									props.segmentIndex,
									"splitLayout",
									{ ...DEFAULT_SPLIT_LAYOUT },
								);
						});
					}}
				>
					<KTabs.List class="grid grid-cols-2 gap-2">
						<KTabs.Trigger value="default" class={SCENE_MODE_TRIGGER_CLASS}>
							<IconLucideMonitor class="size-3.5" />
							{localize("Default")}
						</KTabs.Trigger>
						<KTabs.Trigger value="cameraOnly" class={SCENE_MODE_TRIGGER_CLASS}>
							<IconLucideVideo class="size-3.5" />
							{localize("Camera Only")}
						</KTabs.Trigger>
						<KTabs.Trigger value="hideCamera" class={SCENE_MODE_TRIGGER_CLASS}>
							<IconLucideEyeOff class="size-3.5" />
							{localize("Hide Camera")}
						</KTabs.Trigger>
						<KTabs.Trigger
							value="splitScreen"
							disabled={!hasCamera()}
							class={SCENE_MODE_TRIGGER_CLASS}
						>
							<IconLucideColumns2 class="size-3.5" />
							{localize("Split Screen")}
						</KTabs.Trigger>
						<KTabs.Trigger
							value="floating"
							disabled={!hasCamera()}
							class={SCENE_MODE_TRIGGER_CLASS}
						>
							<IconLucidePanelRight class="size-3.5" />
							{localize("Floating")}
						</KTabs.Trigger>
					</KTabs.List>
					<div class="p-2.5 rounded-lg bg-ed-card-2">
						<div class="text-[11px] text-center text-ed-text-3">
							{description()}
						</div>
					</div>
				</KTabs>
			</Field>

			<Field name="Transition">
				<div class="flex flex-col">
					<Field
						inline
						name="In"
						value={`${(
							props.segment.transitionIn ?? DEFAULT_SCENE_TRANSITION
						).toFixed(2)}s`}
					>
						<Slider
							value={[props.segment.transitionIn ?? DEFAULT_SCENE_TRANSITION]}
							onChange={(v) =>
								setProject(
									"timeline",
									"sceneSegments",
									props.segmentIndex,
									"transitionIn",
									v[0],
								)
							}
							minValue={0}
							maxValue={2}
							step={0.05}
							formatTooltip={(v) => `${v.toFixed(2)}s`}
						/>
					</Field>
					<Field
						inline
						name="Out"
						value={`${(
							props.segment.transitionOut ?? DEFAULT_SCENE_TRANSITION
						).toFixed(2)}s`}
					>
						<Slider
							value={[props.segment.transitionOut ?? DEFAULT_SCENE_TRANSITION]}
							onChange={(v) =>
								setProject(
									"timeline",
									"sceneSegments",
									props.segmentIndex,
									"transitionOut",
									v[0],
								)
							}
							minValue={0}
							maxValue={2}
							step={0.05}
							formatTooltip={(v) => `${v.toFixed(2)}s`}
						/>
					</Field>
				</div>
			</Field>

			<Show
				when={
					props.segment.mode === "splitScreen" ||
					props.segment.mode === "floating"
				}
			>
				<div class="w-full border-t border-ed-line" />
				<Field
					inline
					name="Screen Zoom"
					value={`${Math.round(split().screenZoom * 100)}%`}
				>
					<Slider
						value={[split().screenZoom * 100]}
						onChange={(v) => updateSplit({ screenZoom: v[0] / 100 })}
						minValue={100}
						maxValue={300}
						step={1}
						formatTooltip="%"
					/>
				</Field>
				<Field name="Screen Position">
					<PositionPad
						value={() => split().screenPosition}
						onChange={(pos) => updateSplit({ screenPosition: pos })}
					/>
				</Field>
				<div class="w-full border-t border-ed-line" />
				<Field
					inline
					name="Camera Zoom"
					value={`${Math.round(split().cameraZoom * 100)}%`}
				>
					<Slider
						value={[split().cameraZoom * 100]}
						onChange={(v) => updateSplit({ cameraZoom: v[0] / 100 })}
						minValue={100}
						maxValue={300}
						step={1}
						formatTooltip="%"
					/>
				</Field>
				<Field name="Camera Position">
					<PositionPad
						value={() => split().cameraPosition}
						onChange={(pos) => updateSplit({ cameraPosition: pos })}
					/>
				</Field>
			</Show>
		</>
	);
}

const _CHECKERED_BUTTON_BACKGROUND = `url("data:image/svg+xml,%3Csvg width='16' height='16' xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='8' height='8' fill='%23a0a0a0'/%3E%3Crect x='8' y='8' width='8' height='8' fill='%23a0a0a0'/%3E%3C/svg%3E")`;
