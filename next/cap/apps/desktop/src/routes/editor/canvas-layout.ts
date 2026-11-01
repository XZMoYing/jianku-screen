import type { FrameLayoutEvent } from "~/utils/tauri";
import type { NormRect } from "./snapping";

type CanvasRect = NormRect & { awaitingPosition?: boolean };
export type CanvasRects = { display?: CanvasRect; camera?: CanvasRect };

export function acknowledgeCanvasRects(
	pending: CanvasRects | null,
	layout: FrameLayoutEvent,
): CanvasRects | null {
	if (!pending || layout.output_width <= 0 || layout.output_height <= 0)
		return pending;
	const matches = (
		rect: CanvasRect | undefined,
		bounds: readonly number[] | null,
	) =>
		!!rect &&
		!!bounds &&
		(!rect.awaitingPosition ||
			[
				[rect.x * layout.output_width, bounds[0]],
				[rect.y * layout.output_height, bounds[1]],
				[(rect.x + rect.w) * layout.output_width, bounds[2]],
				[(rect.y + rect.h) * layout.output_height, bounds[3]],
			].every(([expected, actual]) => Math.abs(expected - actual) <= 1));
	const display = matches(pending.display, layout.display);
	const camera = matches(pending.camera, layout.camera);
	if (!display && !camera) return pending;
	const remaining = {
		display: display ? undefined : pending.display,
		camera: camera ? undefined : pending.camera,
	};
	return remaining.display || remaining.camera ? remaining : null;
}
