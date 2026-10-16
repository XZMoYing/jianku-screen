export const DEFAULT_TIMELINE_HEIGHT = 260;

export function editorVerticalLayout(available: number, preferred: number) {
	const height = Math.max(0, available);
	const minPlayerHeight = 320 * Math.min(1, height / 560);
	return {
		minPlayerHeight,
		timelineHeight: Math.round(
			Math.min(Math.max(0, preferred), Math.floor(height - minPlayerHeight)),
		),
	};
}

export function editorInspectorWidth(available: number, preferred: number) {
	const width = Math.max(0, available - 32);
	const minimum = Math.min(292, width * 0.52);
	const maximum = Math.max(minimum, Math.min(560, width - 280));
	return Math.round(
		Math.min(
			maximum,
			Math.max(minimum, Number.isFinite(preferred) ? preferred : 352),
		),
	);
}
