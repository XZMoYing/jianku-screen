import {
	calculateDisplayLayout,
	calculateSceneOutputSize,
} from "~/routes/screenshot-editor/layout";
import type { AspectRatio, BackgroundConfiguration, XY } from "~/utils/tauri";
import type { NormRect } from "./snapping";

export type DisplayResizeInput = {
	imageSize: { width: number; height: number };
	background: Pick<
		BackgroundConfiguration,
		"crop" | "padding" | "frame" | "inset" | "displayPosition"
	>;
	aspectRatio: AspectRatio | null;
	resolutionBase: XY<number>;
	canvasSize?: { width: number; height: number };
};

export function displayResizeLayout(
	input: DisplayResizeInput,
	padding: number,
): NormRect {
	const output = calculateSceneOutputSize(
		input.imageSize,
		padding,
		input.background.crop,
		input.aspectRatio,
		input.resolutionBase,
	);
	const layout = calculateDisplayLayout(
		output,
		input.imageSize,
		padding,
		input.background.crop,
		input.aspectRatio,
		input.background,
		input.canvasSize,
	).outer;
	const canvas = input.canvasSize ?? output;
	return {
		x: layout.offset.x / canvas.width,
		y: layout.offset.y / canvas.height,
		w: layout.size.width / canvas.width,
		h: layout.size.height / canvas.height,
	};
}

export function resolveDisplayResize(
	input: DisplayResizeInput,
	targetWidth: number,
) {
	let low = 0;
	let high = 100;
	let padding = Math.min(100, Math.max(0, input.background.padding));
	let rect = displayResizeLayout(input, padding);
	let distance = Math.abs(rect.w - targetWidth);
	const inspect = (value: number) => {
		const candidate = displayResizeLayout(input, value);
		const error = Math.abs(candidate.w - targetWidth);
		if (error < distance) {
			padding = value;
			rect = candidate;
			distance = error;
		}
		return candidate.w;
	};
	// Output rounding introduces small non-monotonic steps; keep the closest
	// coarse candidate as well as the continuous inverse-search result.
	for (let value = 0; value <= 100; value++) inspect(value);
	for (let step = 0; step < 36; step++) {
		const middle = (low + high) / 2;
		if (inspect(middle) > targetWidth) low = middle;
		else high = middle;
	}
	return { padding, rect };
}
