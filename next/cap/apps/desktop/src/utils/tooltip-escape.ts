// Kobalte consumes tooltip Escape on document before the preview's window listener.
const tooltipEscapes = new WeakSet<KeyboardEvent>();

export function markTooltipEscape(event: KeyboardEvent) {
	tooltipEscapes.add(event);
}

export function canExitPreviewOnEscape(event: KeyboardEvent) {
	if (event.key !== "Escape") return false;
	if (!event.defaultPrevented) return true;
	if (!tooltipEscapes.has(event)) return false;
	return !(
		event.target instanceof Element &&
		event.target.closest(
			'[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
		)
	);
}
