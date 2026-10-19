import { Button } from "@cap/ui-solid";
import {
	isPermissionGranted,
	requestPermission,
} from "@tauri-apps/plugin-notification";
import { type OsType, type } from "@tauri-apps/plugin-os";
import BrandLogo from "~/components/BrandLogo";
import ColorSchemeOptions from "~/components/ColorSchemeSettings";
import {
	type InterfaceLanguage,
	interfaceLanguage,
	t as localize,
	setInterfaceLanguage,
	t,
} from "~/utils/i18n";
import "@total-typescript/ts-reset/filter-boolean";
import { Collapsible } from "@kobalte/core/collapsible";
import { CheckMenuItem, Menu, MenuItem } from "@tauri-apps/api/menu";
import { confirm } from "@tauri-apps/plugin-dialog";
import { cx } from "cva";
import {
	createEffect,
	createMemo,
	createResource,
	createSignal,
	For,
	onMount,
	Show,
} from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import toast from "solid-toast";
import { Input, Slider } from "~/routes/editor/ui";
import {
	audioEnhancementStore,
	generalSettingsStore,
	recordingStartSafetyStore,
} from "~/store";
import {
	deriveGeneralSettings,
	type GeneralSettingsStore,
	RECORDING_START_SAFETY_DEFAULTS,
	type RecordingStartSafetySettings,
} from "~/utils/general-settings";
import {
	type AppTheme,
	type CaptureWindow,
	commands,
	events,
	type MainWindowRecordingStartBehaviour,
	type PostDeletionBehaviour,
	type PostStudioRecordingBehaviour,
	type UpdateChannel,
	type WindowExclusion,
} from "~/utils/tauri";
import IconLucideAlertTriangle from "~icons/lucide/alert-triangle";
import IconLucidePlus from "~icons/lucide/plus";
import IconLucideX from "~icons/lucide/x";
import {
	Section,
	SectionCard,
	SectionRows,
	SettingItem,
	SettingsPageContent,
	ToggleSettingItem,
} from "./Setting";

const getExclusionPrimaryLabel = (entry: WindowExclusion) =>
	entry.ownerName ?? entry.windowTitle ?? entry.bundleIdentifier ?? "Unknown";

const getExclusionSecondaryLabel = (entry: WindowExclusion) => {
	if (entry.ownerName && entry.windowTitle) {
		return entry.windowTitle;
	}

	if (entry.bundleIdentifier && (entry.ownerName || entry.windowTitle)) {
		return entry.bundleIdentifier;
	}

	return entry.bundleIdentifier ?? null;
};

const getWindowOptionLabel = (window: CaptureWindow) => {
	const parts = [window.owner_name];
	if (window.name && window.name !== window.owner_name) {
		parts.push(window.name);
	}
	return parts.join(" • ");
};

const isSameExclusion = (a: WindowExclusion, b: WindowExclusion) =>
	(a.bundleIdentifier ?? null) === (b.bundleIdentifier ?? null) &&
	(a.ownerName ?? null) === (b.ownerName ?? null) &&
	(a.windowTitle ?? null) === (b.windowTitle ?? null);

const coversDefaultExclusion = (
	entry: WindowExclusion,
	defaultEntry: WindowExclusion,
) => {
	if (isSameExclusion(entry, defaultEntry)) return true;
	if (
		defaultEntry.windowTitle &&
		entry.windowTitle === defaultEntry.windowTitle
	) {
		return true;
	}
	if (
		defaultEntry.bundleIdentifier &&
		entry.bundleIdentifier === defaultEntry.bundleIdentifier
	) {
		return true;
	}
	if (defaultEntry.ownerName && entry.ownerName === defaultEntry.ownerName) {
		return !entry.windowTitle || entry.windowTitle === defaultEntry.windowTitle;
	}
	return false;
};

type ExtendedGeneralSettingsStore = GeneralSettingsStore;

const MAX_FPS_OPTIONS = [
	{ value: 24, label: "24 FPS" },
	{ value: 25, label: "25 FPS" },
	{ value: 30, label: "30 FPS" },
	{ value: 60, label: "60 FPS (Recommended)" },
	{ value: 120, label: "120 FPS" },
] satisfies {
	value: number;
	label: string;
}[];

const DEFAULT_PROJECT_NAME_TEMPLATE =
	"{target_name} ({target_kind}) {date} {time}";

export default function GeneralSettings() {
	const [stores] = createResource(() =>
		Promise.all([
			generalSettingsStore.get(),
			recordingStartSafetyStore.get(),
			audioEnhancementStore.get(),
		]),
	);

	return (
		<Show when={stores()} keyed>
			{(stores) => (
				<Inner
					initialStore={stores[0] ?? null}
					initialRecordingStartSafety={
						stores[1] ?? RECORDING_START_SAFETY_DEFAULTS
					}
					initialStudioSoundByDefault={stores[2]?.enabledByDefault ?? true}
				/>
			)}
		</Show>
	);
}

function AppearanceSection(props: {
	currentTheme: AppTheme;
	onThemeChange: (theme: AppTheme) => void;
}) {
	const options = [
		{ id: "light", name: "浅色" },
		{ id: "dark", name: "深色" },
		{ id: "system", name: "跟随系统" },
	] satisfies { id: AppTheme; name: string }[];
	return (
		<Section title={localize("外观")}>
			<div
				class="jk-theme-options"
				role="radiogroup"
				aria-label={localize("应用外观")}
			>
				<For each={options}>
					{(theme) => (
						<button
							type="button"
							role="radio"
							aria-checked={props.currentTheme === theme.id}
							class="jk-theme-option"
							onClick={() => props.onThemeChange(theme.id)}
						>
							<div class="jk-theme-mini" data-theme={theme.id}>
								<i />
								<span>
									<b />
									<b />
									<b />
								</span>
							</div>
							<span>{localize(theme.name)}</span>
						</button>
					)}
				</For>
			</div>
		</Section>
	);
}

function Inner(props: {
	initialStore: GeneralSettingsStore | null;
	initialRecordingStartSafety: RecordingStartSafetySettings;
	initialStudioSoundByDefault: boolean;
}) {
	const [settings, setSettings] = createStore<ExtendedGeneralSettingsStore>(
		deriveGeneralSettings(props.initialStore),
	);
	const [
		confirmBeforeRecordingWithoutMicrophone,
		setConfirmBeforeRecordingWithoutMicrophone,
	] = createSignal(
		props.initialRecordingStartSafety.confirmBeforeRecordingWithoutMicrophone,
	);

	const [studioSoundByDefault, setStudioSoundByDefault] = createSignal(
		props.initialStudioSoundByDefault,
	);

	createEffect(() => {
		setSettings(reconcile(deriveGeneralSettings(props.initialStore)));
	});

	const [windows, { refetch: refetchWindows }] = createResource(
		async () => {
			// Fetch windows with a small delay to avoid blocking initial render
			await new Promise((resolve) => setTimeout(resolve, 100));
			return commands.listCaptureWindows();
		},
		{
			initialValue: [] as CaptureWindow[],
		},
	);
	const [defaultExcludedWindows] = createResource(
		() => commands.getDefaultExcludedWindows(),
		{
			initialValue: [] as WindowExclusion[],
		},
	);

	const handleChange = async <K extends keyof typeof settings>(
		key: K,
		value: (typeof settings)[K],
		extra?: Partial<GeneralSettingsStore>,
	) => {
		console.log(`Handling settings change for ${key}: ${value}`);

		const previousValue = settings[key];
		setSettings(key as keyof GeneralSettingsStore, value);
		try {
			await generalSettingsStore.set({ [key]: value, ...(extra ?? {}) });
		} catch (error) {
			setSettings(key as keyof GeneralSettingsStore, previousValue);
			console.error(`Failed to update ${key}`, error);
		}
	};

	const handleRecordingStartSafetyChange = async (value: boolean) => {
		const previousValue = confirmBeforeRecordingWithoutMicrophone();
		setConfirmBeforeRecordingWithoutMicrophone(value);
		try {
			await recordingStartSafetyStore.set({
				confirmBeforeRecordingWithoutMicrophone: value,
			});
		} catch (error) {
			setConfirmBeforeRecordingWithoutMicrophone(previousValue);
			console.error("Failed to update recording start safety", error);
		}
	};

	const handleStudioSoundByDefaultChange = async (value: boolean) => {
		const previousValue = studioSoundByDefault();
		setStudioSoundByDefault(value);
		try {
			await audioEnhancementStore.set({ enabledByDefault: value });
		} catch (error) {
			setStudioSoundByDefault(previousValue);
			console.error("Failed to update Studio Sound default", error);
		}
	};

	const ostype: OsType = type();
	const excludedWindows = createMemo(() => settings.excludedWindows ?? []);
	const missingDefaultExclusions = createMemo(() =>
		defaultExcludedWindows().filter(
			(defaultEntry) =>
				!excludedWindows().some((entry) =>
					coversDefaultExclusion(entry, defaultEntry),
				),
		),
	);

	const matchesExclusion = (
		exclusion: WindowExclusion,
		window: CaptureWindow,
	) => {
		const bundleMatch = exclusion.bundleIdentifier
			? window.bundle_identifier === exclusion.bundleIdentifier
			: false;
		if (bundleMatch) return true;

		const ownerMatch = exclusion.ownerName
			? window.owner_name === exclusion.ownerName
			: false;

		if (exclusion.ownerName && exclusion.windowTitle) {
			return ownerMatch && window.name === exclusion.windowTitle;
		}

		if (ownerMatch && exclusion.ownerName) {
			return true;
		}

		if (exclusion.windowTitle) {
			return window.name === exclusion.windowTitle;
		}

		return false;
	};

	const isManagedWindowsApp = (window: CaptureWindow) => {
		const bundle = window.bundle_identifier?.toLowerCase() ?? "";
		if (bundle.includes("so.cap.desktop")) {
			return true;
		}
		return window.owner_name.toLowerCase().includes("cap");
	};

	const isWindowAvailable = (window: CaptureWindow) => {
		if (excludedWindows().some((entry) => matchesExclusion(entry, window))) {
			return false;
		}
		if (ostype === "windows") {
			return isManagedWindowsApp(window);
		}
		return true;
	};

	const availableWindows = createMemo(() => {
		const data = windows() ?? [];
		return data.filter(isWindowAvailable);
	});

	const refreshAvailableWindows = async (): Promise<CaptureWindow[]> => {
		try {
			const refreshed = (await refetchWindows()) ?? windows() ?? [];
			return refreshed.filter(isWindowAvailable);
		} catch (error) {
			console.error("Failed to refresh available windows", error);
			return availableWindows();
		}
	};

	const applyExcludedWindows = async (windows: WindowExclusion[]) => {
		setSettings("excludedWindows", windows);
		try {
			await generalSettingsStore.set({ excludedWindows: windows });
			await commands.refreshWindowContentProtection();
			if (ostype === "macos") {
				await events.requestScreenCapturePrewarm.emit({ force: true });
			}
		} catch (error) {
			console.error("Failed to update excluded windows", error);
		}
	};

	const handleRemoveExclusion = async (index: number) => {
		const current = [...excludedWindows()];
		current.splice(index, 1);
		await applyExcludedWindows(current);
	};

	const handleAddWindow = async (window: CaptureWindow) => {
		const windowTitle = window.bundle_identifier ? null : window.name;

		const next = [
			...excludedWindows(),
			{
				bundleIdentifier: window.bundle_identifier ?? null,
				ownerName: window.owner_name ?? null,
				windowTitle,
			},
		];
		await applyExcludedWindows(next);
	};

	const handleResetExclusions = async () => {
		const defaults = await commands.getDefaultExcludedWindows();
		await applyExcludedWindows(defaults);
	};

	// Helper function to render select dropdown for recording behaviors
	const SelectSettingItem = <
		T extends
			| MainWindowRecordingStartBehaviour
			| PostStudioRecordingBehaviour
			| PostDeletionBehaviour
			| number,
	>(props: {
		label: string;
		description: string;
		value: T;
		onChange: (value: T) => void;
		options: { text: string; value: T }[];
	}) => {
		return (
			<SettingItem label={props.label} description={props.description}>
				<button
					type="button"
					class="flex flex-row gap-1.5 text-xs items-center px-2.5 py-1.5 rounded-lg border transition-colors bg-gray-3 hover:bg-gray-4 text-gray-12 border-gray-4"
					onClick={async () => {
						const currentValue = props.value;
						const items = props.options.map((option) =>
							CheckMenuItem.new({
								text: localize(option.text),
								checked: currentValue === option.value,
								action: () => props.onChange(option.value),
							}),
						);
						const menu = await Menu.new({
							items: await Promise.all(items),
						});
						await menu.popup();
						await menu.close();
					}}
				>
					{(() => {
						const currentValue = props.value;
						const option = props.options.find(
							(opt) => opt.value === currentValue,
						);
						return option ? localize(option.text) : currentValue;
					})()}
					<IconCapChevronDown class="size-3.5 text-gray-10" />
				</button>
			</SettingItem>
		);
	};

	return (
		<div class="cap-settings-page flex flex-col h-full custom-scroll">
			<SettingsPageContent>
				<AppearanceSection
					currentTheme={settings.theme ?? "light"}
					onThemeChange={(newTheme) => {
						setSettings("theme", newTheme);
						generalSettingsStore.set({ theme: newTheme });
					}}
				/>

				<Section title={t("界面语言")}>
					<SettingItem label={t("界面语言")}>
						<select
							aria-label={t("界面语言")}
							value={interfaceLanguage()}
							onChange={(event) =>
								void setInterfaceLanguage(
									event.currentTarget.value as InterfaceLanguage,
								).catch((error) => toast.error(String(error)))
							}
						>
							<option value="zh-CN">{localize("简体中文")}</option>
							<option value="en">{localize("English")}</option>
							<option value="system">{t("跟随系统")}</option>
						</select>
					</SettingItem>
				</Section>

				<Section title={localize("配色")}>
					<ColorSchemeOptions />
				</Section>

				{ostype === "macos" && (
					<Section
						title={localize("应用")}
						description={localize("窗口与系统显示。")}
					>
						<SectionRows>
							<ToggleSettingItem
								label={localize("始终显示 Dock 图标")}
								description={localize("关闭所有窗口后仍在 Dock 中保留应用。")}
								value={!settings.hideDockIcon}
								onChange={(v) => handleChange("hideDockIcon", !v)}
							/>
							<ToggleSettingItem
								label={localize("系统通知")}
								description="复制、保存等操作完成时显示通知；需在系统设置中允许通知。"
								value={!!settings.enableNotifications}
								onChange={async (value) => {
									if (value) {
										const permissionGranted = await isPermissionGranted();
										if (!permissionGranted) {
											const permission = await requestPermission();
											if (permission !== "granted") return;
										}
									}
									handleChange("enableNotifications", value);
								}}
							/>
						</SectionRows>
					</Section>
				)}

				<Section
					title={localize("录制")}
					description={localize("开始录制与停止后的行为。")}
				>
					<SectionRows>
						<SelectSettingItem
							label={localize("录制倒计时")}
							description={localize("选择开始录制前的等待时间。")}
							value={settings.recordingCountdown ?? 0}
							onChange={(value) => handleChange("recordingCountdown", value)}
							options={[
								{ text: "关闭", value: 0 },
								{ text: "3 秒", value: 3 },
								{ text: "5 秒", value: 5 },
								{ text: "10 秒", value: 10 },
							]}
						/>
						<ToggleSettingItem
							label={localize("未选择麦克风时确认")}
							description="未选择麦克风或麦克风不可用时，开始录制前提醒。"
							value={confirmBeforeRecordingWithoutMicrophone()}
							onChange={handleRecordingStartSafetyChange}
						/>
						<ToggleSettingItem
							label={localize("新录制默认增强声音")}
							description="自动处理麦克风声音，之后仍可在编辑器关闭。"
							value={studioSoundByDefault()}
							onChange={handleStudioSoundByDefaultChange}
						/>
						<SelectSettingItem
							label={localize("开始录制时的主窗口")}
							description={localize("录制开始后关闭或最小化主窗口。")}
							value={settings.mainWindowRecordingStartBehaviour ?? "close"}
							onChange={(value) =>
								handleChange("mainWindowRecordingStartBehaviour", value)
							}
							options={[
								{ text: "关闭", value: "close" },
								{ text: "最小化", value: "minimise" },
							]}
						/>
						<SelectSettingItem
							label={localize("录制完成后")}
							description={localize("停止录制后的默认操作。")}
							value={settings.postStudioRecordingBehaviour ?? "openEditor"}
							onChange={(value) =>
								handleChange("postStudioRecordingBehaviour", value)
							}
							options={[
								{ text: "打开编辑器", value: "openEditor" },
								{ text: "在浮层中显示", value: "showOverlay" },
							]}
						/>
						<SelectSettingItem
							label={localize("After deleting a recording")}
							description={localize(
								"Whether the recording window should reopen.",
							)}
							value={settings.postDeletionBehaviour ?? "doNothing"}
							onChange={(value) => handleChange("postDeletionBehaviour", value)}
							options={[
								{ text: "不执行操作", value: "doNothing" },
								{
									text: "重新打开录制窗口",
									value: "reopenRecordingWindow",
								},
							]}
						/>
						<ToggleSettingItem
							label={localize("Delete Instant recordings after upload")}
							description={localize(
								"The local file is removed after a successful upload.",
							)}
							value={settings.deleteInstantRecordingsAfterUpload ?? false}
							onChange={(v) =>
								handleChange("deleteInstantRecordingsAfterUpload", v)
							}
						/>
						<ToggleSettingItem
							label={localize("Crash-recoverable recording")}
							description={localize(
								"Record in fragments that can be recovered after a crash or power loss. Slightly larger files during capture.",
							)}
							value={settings.crashRecoveryRecording ?? true}
							onChange={(value) =>
								handleChange("crashRecoveryRecording", value)
							}
						/>
						<ToggleSettingItem
							label={localize("Custom cursor capture (Studio)")}
							description={localize(
								"Capture cursor state separately so you can adjust size and smoothing in the editor.",
							)}
							value={!!settings.custom_cursor_capture2}
							onChange={(value) =>
								handleChange("custom_cursor_capture2", value)
							}
						/>
						<ToggleSettingItem
							label={localize("Auto zoom on clicks")}
							description={localize(
								"Automatically add zoom segments around mouse clicks in Studio recordings.",
							)}
							value={!!settings.autoZoomOnClicks}
							onChange={(value) => handleChange("autoZoomOnClicks", value)}
						/>
						<SettingItem
							label={localize("Default zoom amount")}
							description={localize(
								"Zoom level for newly created and auto-generated zoom segments.",
							)}
						>
							<div class="flex gap-2 items-center w-52">
								<Slider
									class="flex-1"
									value={[settings.defaultZoomAmount ?? 1.5]}
									onChange={(v) => setSettings("defaultZoomAmount", v[0])}
									onChangeEnd={(v) => handleChange("defaultZoomAmount", v[0])}
									minValue={1}
									maxValue={4.5}
									step={0.1}
									formatTooltip="x"
								/>
								<span class="w-9 text-xs text-right text-gray-11 tabular-nums">
									{`${(settings.defaultZoomAmount ?? 1.5).toFixed(1)}x`}
								</span>
							</div>
						</SettingItem>
						<ToggleSettingItem
							label={localize("Capture keyboard presses")}
							description={localize(
								"Record key presses so you can add keyboard overlays in the editor.",
							)}
							value={!!settings.captureKeyboardEvents}
							onChange={(value) => handleChange("captureKeyboardEvents", value)}
						/>
						<ToggleSettingItem
							label={localize("Draw the MacBook notch on screen recordings")}
							description={localize(
								"Automatically restores the notch for new screen and area recordings when the selected region contains the complete notch. External displays, partial areas, and window recordings are left alone. Each recording can override it in the editor.",
							)}
							value={!!settings.macbookNotchOverlay}
							onChange={(value) => handleChange("macbookNotchOverlay", value)}
						/>
						<SelectSettingItem
							label={localize("Max capture framerate")}
							description={
								(settings.maxFps ?? 60) > 60
								? localize(
										"屏幕录制的最高帧率。较高帧率可能导致部分设备丢帧或增加处理器占用。",
									)
								: localize("屏幕录制的最高帧率。")
							}
							value={settings.maxFps ?? 60}
							onChange={(value) => handleChange("maxFps", value)}
							options={MAX_FPS_OPTIONS.map((option) => ({
								text: localize(option.label),
								value: option.value,
							}))}
						/>
					</SectionRows>
				</Section>

				<StorageSection
					recordingsPath={settings.recordingsPath ?? null}
					onPick={async () => {
						try {
							const path = await commands.pickRecordingsFolder();
							if (path !== null) {
								setSettings("recordingsPath", path);
								await offerRecordingsMigration();
							}
						} catch (e) {
							toast.error(
								localize("选择录制文件夹失败：{reason}", { reason: e instanceof Error ? e.message : String(e) }),
							);
						}
					}}
					onReset={async () => {
						try {
							await commands.resetRecordingsFolder();
							setSettings("recordingsPath", null);
							await offerRecordingsMigration();
						} catch (e) {
							toast.error(
								`Failed to reset recordings folder: ${e instanceof Error ? e.message : String(e)}`,
							);
						}
					}}
				/>

				<DefaultProjectNameCard
					onChange={(value) =>
						handleChange("defaultProjectNameTemplate", value)
					}
					value={settings.defaultProjectNameTemplate ?? null}
				/>

				<ExcludedWindowsCard
					excludedWindows={excludedWindows()}
					missingDefaultExclusions={missingDefaultExclusions()}
					availableWindows={availableWindows()}
					onRequestAvailableWindows={refreshAvailableWindows}
					onRemove={handleRemoveExclusion}
					onAdd={handleAddWindow}
					onReset={handleResetExclusions}
					isLoading={windows.loading}
					isWindows={ostype === "windows"}
				/>

				<UpdatesSection
					value={settings.updateChannel ?? "stable"}
					onChange={async (channel) => {
						await handleChange("updateChannel", channel);
						try {
							await commands.updatesChannelChanged();
						} catch (error) {
							console.error("Failed to notify update channel change", error);
						}
					}}
				/>

				<TelemetryCard
					value={settings.enableTelemetry !== false}
					onChange={(v) => handleChange("enableTelemetry", v)}
				/>
			</SettingsPageContent>
		</div>
	);
}

async function offerRecordingsMigration() {
	let count = 0;
	try {
		count = await commands.countRecordingsToMigrate();
	} catch {
		// Recordings in other folders stay visible in the library either way,
		// so a failed scan just means we don't offer the move.
		return;
	}
	if (count === 0) return;

	const plural = count === 1 ? "recording" : "recordings";
	const shouldMove = await confirm(
		`Move your ${count} existing ${plural} to the new location? Recordings stay in your library either way.`,
	);
	if (!shouldMove) return;

	const toastId = toast.loading(`Moving ${count} ${plural}…`);
	let unlisten: (() => void) | undefined;
	try {
		unlisten = await events.recordingsMigrationProgress.listen((e) => {
			toast.loading(
				`Moving recordings… ${Math.min(e.payload.done + 1, e.payload.total)}/${e.payload.total}`,
				{ id: toastId },
			);
		});

		const summary = await commands.migrateRecordingsToCurrentDir();

		const parts = [
			`Moved ${summary.moved} ${summary.moved === 1 ? "recording" : "recordings"}`,
		];
		if (summary.skippedInUse > 0) {
			parts.push(`${summary.skippedInUse} in use — left in place`);
		}
		if (summary.failed.length > 0) {
			parts.push(
				`${summary.failed.length} failed — kept in the original folder`,
			);
			toast.error(parts.join(" · "), { id: toastId });
		} else {
			toast.success(parts.join(" · "), { id: toastId });
		}
	} catch (e) {
		toast.error(
			`Failed to move recordings: ${e instanceof Error ? e.message : String(e)}`,
			{ id: toastId },
		);
	} finally {
		unlisten?.();
	}
}

function StorageSection(props: {
	recordingsPath: string | null;
	onPick: () => Promise<void>;
	onReset: () => Promise<void>;
}) {
	const defaultLabel = "Default (Application Support)";
	const displayPath = () => props.recordingsPath ?? defaultLabel;
	const isCustom = () => props.recordingsPath !== null;

	return (
		<Section
			title={localize("Storage")}
			description={localize("选择新录制内容的保存位置。")}
		>
			<SectionCard padded>
				<div class="flex flex-col gap-3">
					<div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-3 border border-gray-4 min-w-0">
						<span class="flex-1 text-xs text-gray-12 truncate font-mono">
							{displayPath()}
						</span>
					</div>
					<div class="flex justify-end gap-2">
						<Show when={isCustom()}>
							<Button size="sm" variant="gray" onClick={props.onReset}>
								{localize("Reset to Default")}
							</Button>
						</Show>
						<Button size="sm" variant="dark" onClick={props.onPick}>
							{localize("Choose Folder")}
						</Button>
					</div>
				</div>
			</SectionCard>
		</Section>
	);
}

function TelemetryCard(props: {
	value: boolean;
	onChange: (value: boolean) => void;
}) {
	return (
		<Section title={localize("Privacy")}>
			<SectionRows>
				<ToggleSettingItem
					label={localize("Share anonymous telemetry")}
					description={localize(
							"Share anonymous usage data to help improve reliability and fix bugs. Recording contents, window titles, file paths, and personal information are never collected.",
					)}
					value={props.value}
					onChange={props.onChange}
				/>
			</SectionRows>
		</Section>
	);
}

type UpdateChannelOption = {
	value: UpdateChannel;
	label: string;
	description: string;
};

const UPDATE_CHANNEL_OPTIONS: UpdateChannelOption[] = [
	{
		value: "stable",
		label: "Stable",
		description: "Versioned releases (recommended)",
	},
	{
		value: "nightly",
		label: "Nightly",
		description:
			"The newest builds, updated automatically in the background when you're not recording or exporting. May be unstable.",
	},
];

function UpdatesSection(props: {
	value: UpdateChannel;
	onChange: (value: UpdateChannel) => void;
}) {
	const currentOption = createMemo(
		() =>
			UPDATE_CHANNEL_OPTIONS.find((option) => option.value === props.value) ??
			UPDATE_CHANNEL_OPTIONS[0],
	);

	return (
		<Section
			title={localize("Updates")}
			description={localize("选择接收哪个版本通道的更新。")}
		>
			<SectionCard>
				<div class="flex flex-col gap-3 px-4 py-4">
					<div class="flex justify-between items-start gap-4">
						<div class="flex flex-col gap-0.5 min-w-0">
							<p class="text-[13px] text-gray-12">
								{localize("Update channel")}
							</p>
							<p class="text-xs leading-snug text-gray-10">
				{localize("设置应用使用的更新通道。")}
							</p>
						</div>
						<SegmentedControl
							value={props.value}
							onChange={props.onChange}
							options={UPDATE_CHANNEL_OPTIONS.map((option) => ({
								value: option.value,
								label: option.label,
							}))}
						/>
					</div>
					<div class="flex flex-col gap-1.5 px-3 py-2.5 rounded-lg bg-gray-3">
						<p class="text-xs text-gray-12">{currentOption().description}</p>
						<Show when={props.value === "nightly"}>
							<p class="text-[11px] text-gray-10 leading-snug">
								{localize(
									"Switching back to Stable will return you to the latest stable version, which may be older than your current build.",
								)}
							</p>
						</Show>
					</div>
				</div>
			</SectionCard>
		</Section>
	);
}

function SegmentedControl<T extends string | number>(props: {
	value: T;
	onChange: (value: T) => void;
	options: { value: T; label: string }[];
}) {
	return (
		<div class="inline-flex p-0.5 rounded-lg border border-gray-3 bg-gray-3">
			<For each={props.options}>
				{(option) => {
					const isSelected = () => props.value === option.value;
					return (
						<button
							type="button"
							onClick={() => props.onChange(option.value)}
							class={cx(
								"px-3 py-1 text-xs font-medium rounded-md transition-[background-color,color,box-shadow]",
								isSelected()
									? "bg-gray-1 text-gray-12 shadow-sm"
									: "text-gray-10 hover:text-gray-12",
							)}
						>
							{localize(option.label)}
						</button>
					);
				}}
			</For>
		</div>
	);
}

function DefaultProjectNameCard(props: {
	value: string | null;
	onChange: (name: string | null) => Promise<void>;
}) {
	const MOMENT_EXAMPLE_TEMPLATE = "{moment:DDDD, MMMM D, YYYY h:mm A}";
	const macos = type() === "macos";
	const today = new Date();
	const datetime = new Date(
		today.getFullYear(),
		today.getMonth(),
		today.getDate(),
		macos ? 9 : 12,
		macos ? 41 : 0,
		0,
		0,
	).toISOString();

	let inputRef: HTMLInputElement | undefined;

	const dateString = today.toISOString().split("T")[0];
	const initialTemplate = () => props.value ?? DEFAULT_PROJECT_NAME_TEMPLATE;

	const [inputValue, setInputValue] = createSignal<string>(initialTemplate());
	const [preview, setPreview] = createSignal<string | null>(null);
	const [momentExample, setMomentExample] = createSignal("");

	async function updatePreview(val = inputValue()) {
		const formatted = await commands.formatProjectName(
			val,
			macos ? "Safari" : "Chrome",
			"Window",
			"instant",
			datetime,
		);
		setPreview(formatted);
	}

	onMount(() => {
		commands
			.formatProjectName(
				MOMENT_EXAMPLE_TEMPLATE,
				macos ? "Safari" : "Chrome",
				"Window",
				"instant",
				datetime,
			)
			.then(setMomentExample);

		const seed = initialTemplate();
		setInputValue(seed);
		if (inputRef) inputRef.value = seed;
		updatePreview(seed);
	});

	const isSaveDisabled = () => {
		const input = inputValue();
		return (
			!input ||
			input === (props.value ?? DEFAULT_PROJECT_NAME_TEMPLATE) ||
			input.length <= 3
		);
	};

	function CodeView(props: { children: string }) {
		return (
			<button
				type="button"
				title={localize("Click to copy")}
				class="px-1.5 py-0.5 mx-0.5 font-mono text-[11px] rounded-md transition-[background-color,color,transform] duration-150 ease-out bg-gray-3 hover:bg-gray-4 active:scale-95 text-gray-12"
				onClick={() => commands.writeClipboardString(props.children)}
			>
				{props.children}
			</button>
		);
	}

	return (
		<Section
			title={localize("Default project name")}
			description={localize(
				"Template used for new recordings and exported files.",
			)}
			right={
				<>
					<Button
						size="sm"
						variant="gray"
						disabled={
							inputValue() === DEFAULT_PROJECT_NAME_TEMPLATE &&
							inputValue() !== props.value
						}
						onClick={async () => {
							await props.onChange(null);
							const newTemplate = initialTemplate();
							setInputValue(newTemplate);
							if (inputRef) inputRef.value = newTemplate;
							await updatePreview(newTemplate);
						}}
					>
						{localize("Reset")}
					</Button>
					<Button
						size="sm"
						variant="dark"
						disabled={isSaveDisabled()}
						onClick={async () => {
							await props.onChange(inputValue() ?? null);
							await updatePreview();
						}}
					>
						{localize("Save")}
					</Button>
				</>
			}
		>
			<SectionCard padded>
				<div class="flex flex-col gap-3">
					<Input
						autocorrect="off"
						ref={inputRef}
						type="text"
						class="bg-gray-3 font-mono"
						value={inputValue()}
						onInput={(e) => {
							setInputValue(e.currentTarget.value);
							updatePreview(e.currentTarget.value);
						}}
					/>

					<div class="flex gap-2 items-center px-3 py-2 rounded-lg border border-dashed bg-gray-3 border-gray-5">
						<BrandLogo class="pointer-events-none size-4 shrink-0" />
						<p class="text-xs text-gray-12 whitespace-pre-wrap">{preview()}</p>
					</div>

					<Collapsible class="w-full rounded-lg">
						<Collapsible.Trigger class="inline-flex gap-1 items-center text-xs transition-colors text-gray-10 hover:text-gray-12 group">
							<IconCapChevronDown class="size-3.5 data-group-expanded:rotate-180 transition-transform duration-200" />
							<span>{localize("Available placeholders")}</span>
						</Collapsible.Trigger>

						<Collapsible.Content class="space-y-3 pt-3 text-xs text-gray-12 opacity-0 transition animate-collapsible-up data-expanded:animate-collapsible-down data-expanded:opacity-100">
							<p class="text-gray-10">
								{localize(
									"Click any placeholder to copy it. Time supports custom formats via",
								)}
								<code class="text-gray-12">{"{moment:HH:mm}"}</code>.
							</p>

							<div class="space-y-1">
								<p class="font-medium text-gray-12">
									{localize("Recording mode")}
								</p>
								<p>
									<CodeView>{"{recording_mode}"}</CodeView>{" "}
									{localize('→ "Studio", "Instant", or "Screenshot"')}
								</p>
								<p>
									<CodeView>{"{mode}"}</CodeView>{" "}
									{localize('→ "studio", "instant", or "screenshot"')}
								</p>
							</div>

							<div class="space-y-1">
								<p class="font-medium text-gray-12">{localize("Target")}</p>
								<p>
									<CodeView>{"{target_kind}"}</CodeView>{" "}
									{localize('→ "Display", "Window", or "Area"')}
								</p>
								<p>
									<CodeView>{"{target_name}"}</CodeView>{" "}
									{localize("→ Monitor name or window title.")}
								</p>
							</div>

							<div class="space-y-1">
								<p class="font-medium text-gray-12">{localize("Date & time")}</p>
								<p>
									<CodeView>{"{date}"}</CodeView> → {dateString}
								</p>
								<p>
									<CodeView>{"{time}"}</CodeView> →{" "}
									{macos ? "09:41 AM" : "12:00 PM"}
								</p>
								<p class="flex flex-col items-start pt-1">
									<CodeView>{MOMENT_EXAMPLE_TEMPLATE}</CodeView> →{" "}
									{momentExample()}
								</p>
							</div>
						</Collapsible.Content>
					</Collapsible>
				</div>
			</SectionCard>
		</Section>
	);
}

function ExcludedWindowsCard(props: {
	excludedWindows: WindowExclusion[];
	missingDefaultExclusions: WindowExclusion[];
	availableWindows: CaptureWindow[];
	onRequestAvailableWindows: () => Promise<CaptureWindow[]>;
	onRemove: (index: number) => Promise<void>;
	onAdd: (window: CaptureWindow) => Promise<void>;
	onReset: () => Promise<void>;
	isLoading: boolean;
	isWindows: boolean;
}) {
	const hasExclusions = () => props.excludedWindows.length > 0;
	const hasMissingDefaultExclusions = () =>
		props.missingDefaultExclusions.length > 0;
	const missingDefaultLabels = () =>
		props.missingDefaultExclusions.map(getExclusionPrimaryLabel).join(", ");
	const canAdd = () => !props.isLoading;
	const handleResetClick = () => {
		if (props.isLoading) return;
		void props.onReset();
	};

	const handleAddClick = async (event: MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();

		if (!canAdd()) return;

		// Use available windows if we have them, otherwise fetch
		let windows = props.availableWindows;

		// Only refresh if we don't have any windows cached
		if (!windows.length) {
			try {
				windows = await props.onRequestAvailableWindows();
			} catch (error) {
				console.error("Failed to fetch windows:", error);
				return;
			}
		}

		if (!windows.length) {
			console.log("No available windows to exclude");
			return;
		}

		try {
			const items = await Promise.all(
				windows.map((window) =>
					MenuItem.new({
						text: getWindowOptionLabel(window),
						action: () => {
							void props.onAdd(window);
						},
					}),
				),
			);

			const menu = await Menu.new({ items });

			// Save scroll position before popup
			const scrollPos = window.scrollY;

			await menu.popup();
			await menu.close();

			// Restore scroll position after menu closes
			requestAnimationFrame(() => {
				window.scrollTo(0, scrollPos);
			});
		} catch (error) {
			console.error("Error showing window menu:", error);
		}
	};

	return (
		<Section
			title={localize("Excluded windows")}
			description={
				props.isWindows
					? localize(
							"Hide windows from recordings. On Windows, only application windows can be excluded.",
						)
					: "Hide windows from recordings."
			}
			right={
				<>
					<Button
						variant="gray"
						size="sm"
						disabled={props.isLoading}
						onClick={handleResetClick}
					>
						{localize("Reset")}
					</Button>
					<Button
						variant="dark"
						size="sm"
						disabled={!canAdd()}
						onClick={(e) => void handleAddClick(e)}
						class="flex gap-1.5 items-center"
					>
						<IconLucidePlus class="size-3.5" />
						{localize("Add")}
					</Button>
				</>
			}
		>
			<SectionCard padded>
				<Show when={hasMissingDefaultExclusions()}>
					<div class="mb-3 rounded-lg border border-amber-6 bg-amber-3/30 px-3 py-2.5">
						<div class="flex items-start gap-2">
							<IconLucideAlertTriangle class="mt-0.5 size-4 shrink-0 text-amber-11" />
							<div class="min-w-0 flex-1 space-y-1">
								<p class="text-xs font-medium text-amber-11">
							{localize("Some recommended app windows are not excluded")}
								</p>
								<p class="text-[10px] leading-snug text-amber-11">
									{localize(
										"Camera, settings, or recording windows can appear as black boxes in screen recordings. Missing:",
									)}
									{missingDefaultLabels()}.
								</p>
							</div>
							<Button
								variant="gray"
								size="sm"
								disabled={props.isLoading}
								onClick={handleResetClick}
								class="shrink-0"
							>
								{localize("Restore")}
							</Button>
						</div>
					</div>
				</Show>
				<Show when={!props.isLoading} fallback={<ExcludedWindowsSkeleton />}>
					<Show
						when={hasExclusions()}
						fallback={
							<p class="text-xs text-gray-10">
								{localize("No windows are currently excluded.")}
							</p>
						}
					>
						<div class="flex flex-wrap gap-2">
							<For each={props.excludedWindows}>
								{(entry, index) => (
									<div class="flex gap-2 items-center pr-1 pl-3 py-1.5 rounded-full border bg-gray-3 border-gray-4">
										<div class="flex flex-col leading-tight">
											<span class="text-xs text-gray-12">
												{getExclusionPrimaryLabel(entry)}
											</span>
											<Show when={getExclusionSecondaryLabel(entry)}>
												{(label) => (
													<span class="text-[10px] text-gray-9">{label()}</span>
												)}
											</Show>
										</div>
										<button
											type="button"
											class="flex justify-center items-center rounded-full transition-colors size-5 text-gray-10 hover:bg-gray-5 hover:text-gray-12"
											onClick={() => void props.onRemove(index())}
											aria-label={localize("Remove excluded window")}
										>
											<IconLucideX class="size-3" />
										</button>
									</div>
								)}
							</For>
						</div>
					</Show>
				</Show>
			</SectionCard>
		</Section>
	);
}

function ExcludedWindowsSkeleton() {
	const chipWidths = ["w-28", "w-24", "w-32"] as const;

	return (
		<div class="flex flex-wrap gap-2" aria-hidden="true">
			<For each={chipWidths}>
				{(width) => (
					<div class="flex gap-2 items-center pr-1 pl-3 py-1.5 rounded-full border bg-gray-3 border-gray-4 animate-pulse">
						<div class="flex flex-col gap-1 leading-tight">
							<div class={cx("h-2.5 rounded-sm bg-gray-4", width)} />
							<div class="w-14 h-2 rounded-sm bg-gray-4" />
						</div>
						<div class="rounded-full size-5 bg-gray-4" />
					</div>
				)}
			</For>
		</div>
	);
}
