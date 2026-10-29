import { t as localize } from "~/utils/i18n";

const labels = {
	caption: [
		"{count} caption segment selected",
		"{count} caption segments selected",
	],
	keyboard: [
		"{count} keyboard segment selected",
		"{count} keyboard segments selected",
	],
	text: ["{count} text segment selected", "{count} text segments selected"],
	audio: ["{count} audio segment selected", "{count} audio segments selected"],
	mask: ["{count} mask segment selected", "{count} mask segments selected"],
	scene: ["{count} scene segment selected", "{count} scene segments selected"],
} as const;

export type SelectableSegmentKind = keyof typeof labels;

export function selectedSegmentLabel(
	kind: SelectableSegmentKind,
	count: number,
) {
	return localize(labels[kind][count === 1 ? 0 : 1], { count });
}
