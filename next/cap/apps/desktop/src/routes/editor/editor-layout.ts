export const DEFAULT_TIMELINE_HEIGHT = 260;
const EDITOR_PANEL_GUTTERS = 32;
const MATERIALS_PANEL_GAP = 8;
const MIN_DOCKED_PREVIEW_WIDTH = 640;

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

export function editorInspectorWidth(
	available: number,
	preferred: number,
	minimumPreviewWidth = 280,
) {
	const width = Math.max(0, available - EDITOR_PANEL_GUTTERS);
	const minimum = Math.min(292, width * 0.52);
	const maximum = Math.max(minimum, Math.min(560, width - minimumPreviewWidth));
	return Math.round(
		Math.min(
			maximum,
			Math.max(minimum, Number.isFinite(preferred) ? preferred : 352),
		),
	);
}

export function editorMaterialsDocked(
	available: number,
	materialsWidth: number,
	inspectorWidth: number,
) {
	return (
		available -
			materialsWidth -
			MATERIALS_PANEL_GAP -
			inspectorWidth -
			EDITOR_PANEL_GUTTERS >=
		MIN_DOCKED_PREVIEW_WIDTH
	);
}
