import {
	ACTION_LABELS,
	type ActionType,
	type AutomationRule,
	type Trigger,
} from "./automations";
import { t } from "./i18n";

const TRIGGER_PHRASE: Record<Trigger, string> = {
	screenshotTaken: "Screenshot taken",
	studioRecordingFinished: "Studio recording ends",
	instantRecordingFinished: "Instant recording ends",
	recordingStarted: "Recording starts",
	uploadCompleted: "Upload completes",
	videoImported: "Video imported",
	recordingDeleted: "Recording deleted",
};

const ACTION_SHORT: Record<ActionType, string> = {
	copyToClipboard: "Copy to clipboard",
	saveToLocation: "Save to folder",
	export: "Export",
	upload: "Upload & copy link",
	revealInFileManager: "Reveal in file manager",
	openFile: "Open file",
	recognizeTextToClipboard: "Copy text (OCR)",
	notify: "Notify",
	openEditor: "Open editor",
	skipEditor: "Skip editor",
	applyPreset: "Apply preset",
	runCommand: "Run command",
	webhook: "Send webhook",
	deleteLocalFiles: "Delete local files",
};

const TRIGGER_NOUN: Record<Trigger, string> = {
	screenshotTaken: "Screenshot",
	studioRecordingFinished: "Studio recording",
	instantRecordingFinished: "Instant recording",
	recordingStarted: "Recording start",
	uploadCompleted: "Upload",
	videoImported: "Import",
	recordingDeleted: "Deletion",
};

const ACTION_NOUN: Record<ActionType, string> = {
	copyToClipboard: "Clipboard",
	saveToLocation: "Folder",
	export: "Export",
	upload: "Upload",
	revealInFileManager: "Reveal",
	openFile: "Open",
	recognizeTextToClipboard: "Text",
	notify: "Notify",
	openEditor: "Editor",
	skipEditor: "Skip editor",
	applyPreset: "Preset",
	runCommand: "Command",
	webhook: "Webhook",
	deleteLocalFiles: "Delete",
};

const TRIGGER_EXPLANATIONS: Record<Trigger, string> = {
	screenshotTaken: "Runs whenever a screenshot is taken.",
	studioRecordingFinished: "Runs whenever a Studio recording finishes.",
	instantRecordingFinished: "Runs whenever an Instant recording finishes.",
	recordingStarted: "Runs whenever a recording starts.",
	uploadCompleted: "Runs whenever an upload completes.",
	videoImported: "Runs whenever a video is imported.",
	recordingDeleted: "Runs whenever a recording is deleted.",
};

export function automationTriggerExplanation(trigger: Trigger): string {
	return t(TRIGGER_EXPLANATIONS[trigger]);
}

export function automationRuleSummary(
	rule: Pick<AutomationRule, "trigger" | "actions">,
): string {
	return t("{trigger} → {actions}", {
		trigger: t(TRIGGER_PHRASE[rule.trigger]),
		actions: rule.actions.length
			? rule.actions.map((action) => t(ACTION_SHORT[action.type])).join(t(", "))
			: t("No actions yet"),
	});
}

export function automationRuleDefaultName(
	rule: Pick<AutomationRule, "trigger" | "actions">,
): string {
	const trigger = t(TRIGGER_NOUN[rule.trigger]);
	const first = rule.actions[0];
	return first
		? t("{trigger} → {actions}", {
				trigger,
				actions: t(ACTION_NOUN[first.type]),
			})
		: t("{trigger} automation", { trigger });
}

export function automationRuleDisplayName(
	rule: Pick<AutomationRule, "trigger" | "actions" | "name">,
): string {
	return rule.name.trim() || automationRuleDefaultName(rule);
}

export function automationUnsupportedMessage(types: readonly string[]): string {
	return t("{count} actions are not supported on this device: {actions}", {
		count: types.length,
		actions: types
			.map((type) => {
				const label = Object.entries(ACTION_LABELS).find(
					([key]) => key === type,
				)?.[1];
				return label ? t(label) : t("Unknown action ({type})", { type });
			})
			.join(t(", ")),
	});
}
