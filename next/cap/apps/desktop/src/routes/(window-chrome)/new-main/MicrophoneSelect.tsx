import { cx } from "cva";
import {
	type Component,
	type ComponentProps,
	createSignal,
	Show,
} from "solid-js";
import { LocalizedChoiceSelect } from "~/components/LocalizedChoiceSelect";
import { MotionText } from "~/components/MotionText";
import { trackEvent } from "~/utils/analytics";
import { createTauriEventListener } from "~/utils/createEventListener";
import { t as localize } from "~/utils/i18n";
import { createCurrentRecordingQuery } from "~/utils/queries";
import { events, type OSPermissionsCheck } from "~/utils/tauri";
import {
	DEVICE_ROW_CLASS,
	DEVICE_ROW_ICON_CLASS,
	DEVICE_ROW_LABEL_CLASS,
	DEVICE_ROW_TRAILING_CLASS,
	DEVICE_SHORTCUT_BUTTON_CLASS,
} from "./deviceRowStyles";
import InfoPill from "./InfoPill";
import TargetSelectInfoPill from "./TargetSelectInfoPill";
import useRequestPermission from "./useRequestPermission";

const NO_MICROPHONE = "未选择麦克风";

export default function MicrophoneSelect(props: {
	disabled?: boolean;
	options: string[];
	value: string | null;
	disconnected?: boolean;
	onChange: (micName: string | null) => void;
	permissions?: OSPermissionsCheck;
	onOpen?: () => void;
	onOpenSettings?: () => void;
}) {
	const DB_SCALE = 40;
	const currentRecording = createCurrentRecordingQuery();
	const requestPermission = useRequestPermission();

	const [dbs, setDbs] = createSignal<number | undefined>();

	const permissionGranted = () =>
		props.permissions === undefined ||
		props.permissions.microphone === "granted" ||
		props.permissions.microphone === "notNeeded";

	const notConnected = () => !!props.disconnected && permissionGranted();

	const handleMicrophoneChange = async (name: string | null) => {
		if (!props.options) return;
		props.onChange(name);
		if (!name) setDbs();

		trackEvent("microphone_selected", {
			microphone_name: name ?? null,
			enabled: !!name,
		});
	};

	createTauriEventListener(events.audioInputLevelChange, (d) => {
		if (!props.value) setDbs();
		else setDbs(d);
	});

	const audioLevel = () =>
		(1 - Math.max((dbs() ?? 0) + DB_SCALE, 0) / DB_SCALE) ** 0.5;

	const showLevel = () =>
		props.value !== null && dbs() !== undefined && !notConnected();

	const showSettingsShortcut = () =>
		props.value !== null &&
		permissionGranted() &&
		!!props.onOpenSettings &&
		!notConnected();

	const isDisabled = () => !!currentRecording.data || props.disabled;

	return (
		<div class="flex flex-col items-stretch text-(--text-primary)">
			<div
				class={cx(DEVICE_ROW_CLASS, "KSelect jk-device-row")}
				data-disabled={isDisabled() ? "" : undefined}
			>
				<button
					type="button"
					disabled={isDisabled()}
					class="jk-device-open"
					onClick={() => {
						if (!permissionGranted()) {
							requestPermission("microphone", props.permissions?.microphone);
							return;
						}
						props.onOpen?.();
					}}
					aria-haspopup="menu"
				>
					<Show when={showLevel()}>
						<div
							class="absolute inset-y-0 left-0 -z-10 transition-[right] duration-100 pointer-events-none bg-blue-9/10"
							style={{ right: `${audioLevel() * 100}%` }}
						/>
						<div
							class="absolute bottom-0 left-0 h-[2px] -z-10 transition-[right] duration-100 pointer-events-none bg-blue-9"
							style={{ right: `${audioLevel() * 100}%` }}
						/>
					</Show>
					<IconCapMicrophone class={DEVICE_ROW_ICON_CLASS} />
					<p
						class={cx(DEVICE_ROW_LABEL_CLASS, notConnected() && "text-gray-10")}
						title={notConnected() ? localize("Not connected") : undefined}
					>
						<MotionText text={props.value ?? localize(NO_MICROPHONE)} />
					</p>
				</button>
				<div class={DEVICE_ROW_TRAILING_CLASS}>
					<Show when={showSettingsShortcut()}>
						<button
							type="button"
							disabled={isDisabled()}
							onClick={(e) => {
								e.preventDefault();
								e.stopPropagation();
								props.onOpenSettings?.();
							}}
							onPointerDown={(e) => e.stopPropagation()}
							class={DEVICE_SHORTCUT_BUTTON_CLASS}
							title={localize("Microphone settings")}
							aria-label={localize("Microphone settings")}
						>
							<IconLucideSettings class="size-3.5" />
						</button>
					</Show>
					<TargetSelectInfoPill
						PillComponent={InfoPill}
						disabled={isDisabled()}
						value={props.value}
						disconnected={notConnected()}
						permissionGranted={permissionGranted()}
						requestPermission={() =>
							requestPermission("microphone", props.permissions?.microphone)
						}
						onClick={(e) => {
							if (props.value !== null) {
								e.stopPropagation();
								void handleMicrophoneChange(null);
							} else {
								props.onOpen?.();
							}
						}}
					/>
				</div>
			</div>
		</div>
	);
}

export function MicrophoneSelectBase(props: {
	disabled?: boolean;
	options: string[];
	value: string | null;
	onChange: (micName: string | null) => void;
	class: string;
	levelIndicatorClass: string;
	iconClass: string;
	PillComponent: Component<
		ComponentProps<"button"> & { variant: "blue" | "red" | "gray" }
	>;
	permissions?: OSPermissionsCheck;
}) {
	let choiceTrigger: HTMLButtonElement | undefined;
	const DB_SCALE = 40;

	const currentRecording = createCurrentRecordingQuery();

	const [dbs, setDbs] = createSignal<number | undefined>();

	const requestPermission = useRequestPermission();

	const permissionGranted = () =>
		props.permissions === undefined ||
		props.permissions.microphone === "granted" ||
		props.permissions.microphone === "notNeeded";

	const isDisabled = () => !!currentRecording.data || props.disabled;
	const selectedValue = () =>
		props.value === null ? "none" : `microphone:${props.value}`;
	const choices = () => {
		const items: { value: string; label: string; disabled?: boolean }[] =
			props.options.map((name) => ({
				value: `microphone:${name}`,
				label: name,
			}));
		if (props.value !== null && !props.options.includes(props.value))
			items.push({
				value: selectedValue(),
				label: props.value,
				disabled: true,
			});
		return [{ value: "none", label: localize(NO_MICROPHONE) }, ...items];
	};

	type Option = { name: string };

	const handleMicrophoneChange = async (item: Option | null) => {
		if (!props.options) return;
		props.onChange(item ? item.name : null);
		if (!item) setDbs();

		trackEvent("microphone_selected", {
			microphone_name: item?.name ?? null,
			enabled: !!item,
		});
	};

	createTauriEventListener(events.audioInputLevelChange, (dbs) => {
		if (!props.value) setDbs();
		else setDbs(dbs);
	});

	const audioLevel = () =>
		(1 - Math.max((dbs() ?? 0) + DB_SCALE, 0) / DB_SCALE) ** 0.5;

	return (
		<div
			class={cx(props.class, "jk-device-choice")}
			data-disabled={isDisabled() ? "" : undefined}
		>
			<Show when={props.value !== null && dbs() !== undefined}>
				<div
					class={cx(
						"absolute inset-y-0 left-0 pointer-events-none opacity-50 transition-[right] duration-100 -z-10",
						props.levelIndicatorClass,
					)}
					style={{ right: `${audioLevel() * 100}%` }}
				/>
			</Show>
			<IconCapMicrophone class={props.iconClass} />
			<Show
				when={permissionGranted()}
				fallback={
					<button
						type="button"
						class="jk-device-open"
						disabled={isDisabled()}
						onClick={() =>
							requestPermission("microphone", props.permissions?.microphone)
						}
					>
						<MotionText text={props.value ?? localize(NO_MICROPHONE)} />
					</button>
				}
			>
				<LocalizedChoiceSelect
					preserveLabels
					aria-label={localize("Microphone")}
					triggerRef={(element) => {
						choiceTrigger = element;
					}}
					value={selectedValue()}
					options={choices()}
					disabled={isDisabled()}
					onChange={(value) => {
						if (value === "none") return void handleMicrophoneChange(null);
						const name = props.options.find(
							(item) => `microphone:${item}` === value,
						);
						if (name !== undefined) void handleMicrophoneChange({ name });
					}}
				/>
			</Show>
			<TargetSelectInfoPill
				PillComponent={props.PillComponent}
				value={props.value}
				disabled={isDisabled()}
				permissionGranted={permissionGranted()}
				requestPermission={() =>
					requestPermission("microphone", props.permissions?.microphone)
				}
				onClick={() => {
					if (props.value === null) choiceTrigger?.click();
					else void handleMicrophoneChange(null);
				}}
			/>
		</div>
	);
}
