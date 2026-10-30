import { createTimer } from "@solid-primitives/timer";
import { cx } from "cva";
import {
	type Component,
	type ComponentProps,
	createEffect,
	createSignal,
	Show,
} from "solid-js";
import { LocalizedChoiceSelect } from "~/components/LocalizedChoiceSelect";
import { MotionText } from "~/components/MotionText";
import { trackEvent } from "~/utils/analytics";
import { t as localize } from "~/utils/i18n";
import { createCurrentRecordingQuery } from "~/utils/queries";
import {
	type CameraInfo,
	commands,
	type DeviceOrModelID,
	type OSPermissionsCheck,
} from "~/utils/tauri";
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

const NO_CAMERA = "未选择摄像头";

export default function CameraSelect(props: {
	disabled?: boolean;
	options: CameraInfo[];
	value: CameraInfo | null;
	selectedLabel?: string | null;
	isSelected?: boolean;
	disconnected?: boolean;
	onChange: (camera: CameraInfo | null) => void;
	permissions?: OSPermissionsCheck;
	hidePreviewButton?: boolean;
	onOpen?: () => void;
	onOpenSettings?: () => void;
}) {
	const currentRecording = createCurrentRecordingQuery();
	const requestPermission = useRequestPermission();
	const [cameraWindowOpen, setCameraWindowOpen] = createSignal(false);

	const refreshCameraWindowState = async () => {
		try {
			setCameraWindowOpen(await commands.isCameraWindowOpen());
		} catch {
			setCameraWindowOpen(false);
		}
	};

	createEffect(() => {
		if (props.value) {
			void refreshCameraWindowState();
		} else {
			setCameraWindowOpen(false);
		}
	});

	createTimer(
		() => {
			if (props.value) {
				void refreshCameraWindowState();
			}
		},
		2000,
		setInterval,
	);

	const openCameraWindow = async (e: MouseEvent) => {
		e.stopPropagation();
		try {
			if (props.value) {
				const id: DeviceOrModelID = props.value.model_id
					? { ModelID: props.value.model_id }
					: { DeviceID: props.value.device_id };
				await commands.setCameraInput(id, false);
			} else {
				await commands.showWindow({ Camera: { centered: false } });
			}
		} catch (error) {
			console.warn("Failed to open camera preview:", error);
		}
		await refreshCameraWindowState();
	};

	const permissionGranted = () =>
		props.permissions === undefined ||
		props.permissions.camera === "granted" ||
		props.permissions.camera === "notNeeded";

	const notConnected = () => !!props.disconnected && permissionGranted();

	const hasSelection = () => props.isSelected ?? props.value !== null;

	const label = () =>
		props.value?.display_name ??
		(hasSelection() ? props.selectedLabel : null) ??
		(hasSelection() ? localize("Camera") : localize(NO_CAMERA));

	const showHiddenIndicator = () =>
		props.value !== null &&
		permissionGranted() &&
		!cameraWindowOpen() &&
		!props.hidePreviewButton &&
		!notConnected();

	const showSettingsShortcut = () =>
		hasSelection() &&
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
					onClick={() => {
						if (!permissionGranted()) {
							requestPermission("camera", props.permissions?.camera);
							return;
						}
						props.onOpen?.();
					}}
					class="jk-device-open"
					aria-haspopup="menu"
				>
					<IconCapCamera class={DEVICE_ROW_ICON_CLASS} />
					<p
						class={cx(DEVICE_ROW_LABEL_CLASS, notConnected() && "text-gray-10")}
						title={notConnected() ? localize("Not connected") : undefined}
					>
						<MotionText text={label()} />
					</p>
				</button>
				<div class={DEVICE_ROW_TRAILING_CLASS}>
					<Show when={showHiddenIndicator()}>
						<button
							type="button"
							disabled={isDisabled()}
							onClick={openCameraWindow}
							onPointerDown={(e) => e.stopPropagation()}
							class={DEVICE_SHORTCUT_BUTTON_CLASS}
							title={localize("Show camera preview")}
							aria-label={localize("Show camera preview")}
						>
							<IconLucideEyeOff class="size-3.5" />
						</button>
					</Show>
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
							title={localize("Camera settings")}
							aria-label={localize("Camera settings")}
						>
							<IconLucideSettings class="size-3.5" />
						</button>
					</Show>
					<TargetSelectInfoPill
						PillComponent={InfoPill}
						disabled={isDisabled()}
						value={hasSelection() ? true : null}
						disconnected={notConnected()}
						permissionGranted={permissionGranted()}
						requestPermission={() =>
							requestPermission("camera", props.permissions?.camera)
						}
						onClick={(e) => {
							if (!props.options) return;
							if (hasSelection()) {
								e.stopPropagation();
								props.onChange(null);
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

export function CameraSelectBase(props: {
	disabled?: boolean;
	options: CameraInfo[];
	value: CameraInfo | null;
	onChange: (camera: CameraInfo | null) => void;
	PillComponent: Component<
		ComponentProps<"button"> & { variant: "blue" | "red" | "gray" }
	>;
	class: string;
	iconClass: string;
	permissions?: OSPermissionsCheck;
	hidePreviewButton?: boolean;
}) {
	let choiceTrigger: HTMLButtonElement | undefined;
	const currentRecording = createCurrentRecordingQuery();
	const requestPermission = useRequestPermission();
	const [cameraWindowOpen, setCameraWindowOpen] = createSignal(false);

	const refreshCameraWindowState = async () => {
		try {
			setCameraWindowOpen(await commands.isCameraWindowOpen());
		} catch {
			setCameraWindowOpen(false);
		}
	};

	createEffect(() => {
		if (props.value) {
			void refreshCameraWindowState();
		} else {
			setCameraWindowOpen(false);
		}
	});

	createTimer(
		() => {
			if (props.value) {
				void refreshCameraWindowState();
			}
		},
		2000,
		setInterval,
	);

	const openCameraWindow = async (e: MouseEvent) => {
		e.stopPropagation();
		try {
			if (props.value) {
				const id: DeviceOrModelID = props.value.model_id
					? { ModelID: props.value.model_id }
					: { DeviceID: props.value.device_id };
				await commands.setCameraInput(id, false);
			} else {
				await commands.showWindow({ Camera: { centered: false } });
			}
		} catch (error) {
			console.warn("Failed to open camera preview:", error);
		}
		await refreshCameraWindowState();
	};

	const permissionGranted = () =>
		props.permissions === undefined ||
		props.permissions.camera === "granted" ||
		props.permissions.camera === "notNeeded";

	const isDisabled = () => !!currentRecording.data || props.disabled;
	const selectedValue = () =>
		props.value ? `camera:${props.value.device_id}` : "none";
	const choices = () => {
		const items: { value: string; label: string; disabled?: boolean }[] =
			props.options.map((camera) => ({
				value: `camera:${camera.device_id}`,
				label: camera.display_name,
			}));
		if (
			props.value &&
			!props.options.some(
				(camera) => camera.device_id === props.value?.device_id,
			)
		)
			items.push({
				value: selectedValue(),
				label: props.value.display_name,
				disabled: true,
			});
		return [{ value: "none", label: localize(NO_CAMERA) }, ...items];
	};

	const onChange = (cameraLabel: CameraInfo | null) => {
		if (!cameraLabel && !permissionGranted())
			return requestPermission("camera", props.permissions?.camera);

		props.onChange(cameraLabel);

		trackEvent("camera_selected", {
			camera_name: cameraLabel?.display_name ?? null,
			enabled: !!cameraLabel,
		});
	};

	const showHiddenIndicator = () =>
		props.value !== null &&
		permissionGranted() &&
		!cameraWindowOpen() &&
		!props.hidePreviewButton;

	return (
		<div
			class={cx(props.class, "jk-device-choice")}
			data-disabled={isDisabled() ? "" : undefined}
		>
			<IconCapCamera class={props.iconClass} />
			<Show
				when={permissionGranted()}
				fallback={
					<button
						type="button"
						class="jk-device-open"
						disabled={isDisabled()}
						onClick={() =>
							requestPermission("camera", props.permissions?.camera)
						}
					>
						<MotionText
							text={props.value?.display_name ?? localize(NO_CAMERA)}
						/>
					</button>
				}
			>
				<LocalizedChoiceSelect
					preserveLabels
					aria-label={localize("Camera")}
					triggerRef={(element) => {
						choiceTrigger = element;
					}}
					value={selectedValue()}
					options={choices()}
					disabled={isDisabled()}
					onChange={(value) => {
						if (value === "none") return onChange(null);
						const camera = props.options.find(
							(item) => `camera:${item.device_id}` === value,
						);
						if (camera) onChange(camera);
					}}
				/>
			</Show>
			<div class="flex items-center gap-1">
				<Show when={showHiddenIndicator()}>
					<button
						type="button"
						disabled={isDisabled()}
						onClick={openCameraWindow}
						class={DEVICE_SHORTCUT_BUTTON_CLASS}
						title={localize("Show camera preview")}
						aria-label={localize("Show camera preview")}
					>
						<IconLucideEyeOff class="size-3.5" />
					</button>
				</Show>
				<TargetSelectInfoPill
					PillComponent={props.PillComponent}
					value={props.value}
					disabled={isDisabled()}
					permissionGranted={permissionGranted()}
					requestPermission={() =>
						requestPermission("camera", props.permissions?.camera)
					}
					onClick={() => {
						if (props.value === null) choiceTrigger?.click();
						else onChange(null);
					}}
				/>
			</div>
		</div>
	);
}
