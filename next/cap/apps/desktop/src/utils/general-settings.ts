import type {
	RecordingMode,
	GeneralSettingsStore as TauriGeneralSettingsStore,
} from "~/utils/tauri";

export type GeneralSettingsStore = TauriGeneralSettingsStore & {
	captureKeyboardEvents?: boolean;
	transcriptionHints?: string[];
	enableTelemetry?: boolean;
	outOfProcessMuxer?: boolean;
	enableGpuiApp?: boolean;
};

export const DEFAULT_TRANSCRIPTION_HINTS = [
	"简库镜传",
	"TypeScript",
	"我的品牌名",
	"example.com",
];

function sanitizeLegacyTranscriptionHints(
	hints: readonly string[] | undefined,
): string[] | undefined {
	if (!hints) return hints;
	const hasLegacyDefault =
		hints.includes("Cap") &&
		(hints.includes("My Brand Name") || hints.includes("mywebsite.com"));
	if (!hasLegacyDefault) return [...hints];
	return hints.map((hint) => {
		if (hint === "Cap") return "简库镜传";
		if (hint === "My Brand Name") return "我的品牌名";
		if (hint === "mywebsite.com") return "example.com";
		return hint;
	});
}

export type RecordingStartSafetySettings = {
	confirmBeforeRecordingWithoutMicrophone: boolean;
};

export const RECORDING_START_SAFETY_DEFAULTS: RecordingStartSafetySettings = {
	confirmBeforeRecordingWithoutMicrophone: true,
};

export function shouldConfirmRecordingWithoutMicrophone(
	mode: RecordingMode,
	confirmBeforeRecordingWithoutMicrophone: boolean,
	selectedMicrophone: string | null,
): boolean {
	return (
		mode !== "screenshot" &&
		confirmBeforeRecordingWithoutMicrophone &&
		selectedMicrophone === null
	);
}

export function createDefaultGeneralSettings(): GeneralSettingsStore {
	return {
		uploadIndividualFiles: false,
		hideDockIcon: false,
		autoCreateShareableLink: false,
		enableNotifications: true,
		enableNativeCameraPreview: false,
		autoZoomOnClicks: false,
		// Off until the backend seeds it from whether this machine has a notch.
		macbookNotchOverlay: false,
		captureKeyboardEvents: true,
		custom_cursor_capture2: true,
		isolateWindowCapture: false,
		excludedWindows: [],
		instantModeMaxResolution: 1920,
		crashRecoveryRecording: true,
		maxFps: 60,
		transcriptionHints: [...DEFAULT_TRANSCRIPTION_HINTS],
		enableTelemetry: true,
	};
}

export function deriveGeneralSettings(
	store: GeneralSettingsStore | null | undefined,
): GeneralSettingsStore {
	const merged: GeneralSettingsStore = {
		...createDefaultGeneralSettings(),
		...(store ?? {}),
	};
	return {
		...merged,
		transcriptionHints: sanitizeLegacyTranscriptionHints(
			merged.transcriptionHints,
		),
	};
}

export function normalizeTranscriptionHints(
	hints: readonly string[],
): string[] {
	const normalized: string[] = [];

	for (const hint of hints) {
		const value = hint.replaceAll("\0", "").trim();
		if (!value || normalized.includes(value)) continue;
		normalized.push(value);
	}

	return normalized;
}

export function parseTranscriptionHints(value: string): string[] {
	return normalizeTranscriptionHints(value.split(/\r?\n/));
}

export function formatTranscriptionHints(
	hints: readonly string[] | null | undefined,
): string {
	return normalizeTranscriptionHints(hints ?? []).join("\n");
}
