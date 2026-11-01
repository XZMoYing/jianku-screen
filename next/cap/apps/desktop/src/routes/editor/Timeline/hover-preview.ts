type HoverPreviewOptions = {
	pointerDown: () => boolean;
	playbackIntent: () => boolean;
	metrics: () => { left: number; width: number } | null;
	position: () => number;
	secondsPerPixel: () => number;
	startSnapPixels: number;
	setPreviewTime: (time: number | null) => void;
};

export function createTimelineHoverPreview(options: HoverPreviewOptions) {
	// Segment trims and playhead scrubs own preview time while held. A bubbling
	// hover event must not request another frame before the window drag handler.
	const blocked = (event: MouseEvent) =>
		options.pointerDown() || event.buttons !== 0;
	return {
		onMouseMove(event: MouseEvent) {
			if (blocked(event) || options.playbackIntent()) return;
			const metrics = options.metrics();
			if (!metrics || metrics.width <= 0) return;
			const offset = event.clientX - metrics.left;
			if (offset < 0 || offset > metrics.width) {
				options.setPreviewTime(null);
				return;
			}
			const time = options.position() + options.secondsPerPixel() * offset;
			options.setPreviewTime(
				time / options.secondsPerPixel() <= options.startSnapPixels ? 0 : time,
			);
		},
		onMouseLeave(event: MouseEvent) {
			if (!blocked(event)) options.setPreviewTime(null);
		},
	};
}
