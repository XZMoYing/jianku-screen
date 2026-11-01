import { describe, expect, it } from "vitest";
import type { FrameLayoutEvent } from "~/utils/tauri";
import { acknowledgeCanvasRects, type CanvasRects } from "./canvas-layout";

const display = { awaitingPosition: true, x: 0.1, y: 0.2, w: 0.6, h: 0.5 };
const camera = { awaitingPosition: true, x: 0.75, y: 0.7, w: 0.2, h: 0.25 };
const layout = (): FrameLayoutEvent => ({
	display: [192, 216, 1344, 756],
	camera: [1440, 756, 1824, 1026],
	output_width: 1920,
	output_height: 1080,
});

describe("rendered canvas geometry acknowledgement", () => {
	it("keeps the final pointer geometry when an older frame arrives", () => {
		const pending = { display };
		expect(
			acknowledgeCanvasRects(pending, {
				...layout(),
				display: [180, 210, 1332, 750],
			}),
		).toBe(pending);
	});

	it("releases the outline when the final geometry has reached the renderer", () => {
		expect(acknowledgeCanvasRects({ display, camera }, layout())).toBeNull();
	});

	it("acknowledges the display and camera independently", () => {
		const pending = { display, camera };
		const remaining = acknowledgeCanvasRects(pending, {
			...layout(),
			camera: null,
		});
		expect(remaining).toEqual({ display: undefined, camera });
		expect(acknowledgeCanvasRects(remaining, layout())).toBeNull();
	});

	it("retains an absent camera rather than treating it as an acknowledgement", () => {
		const pending = { camera };
		expect(acknowledgeCanvasRects(pending, { ...layout(), camera: null })).toBe(
			pending,
		);
	});

	it("allows one output pixel of rounding without using preview CSS pixels", () => {
		expect(
			acknowledgeCanvasRects(
				{ display },
				{
					...layout(),
					display: [193, 215, 1344.5, 755.5],
				},
			),
		).toBeNull();
		const pending = { display };
		expect(
			acknowledgeCanvasRects(pending, {
				...layout(),
				display: [194, 216, 1344, 756],
			}),
		).toBe(pending);
	});

	it("accepts equivalent geometry at a different preview resolution", () => {
		expect(
			acknowledgeCanvasRects(
				{ display, camera },
				{
					display: [96, 108, 672, 378],
					camera: [720, 378, 912, 513],
					output_width: 960,
					output_height: 540,
				},
			),
		).toBeNull();
	});

	it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
		"does not acknowledge an invalid output width %s",
		(output_width) => {
			const pending = { display };
			expect(
				acknowledgeCanvasRects(pending, { ...layout(), output_width }),
			).toBe(pending);
		},
	);

	it("ignores nonfinite reported bounds", () => {
		const pending = { display };
		expect(
			acknowledgeCanvasRects(pending, {
				...layout(),
				display: [Number.NaN, 216, 1344, 756],
			}),
		).toBe(pending);
	});

	it("does nothing without an optimistic outline", () => {
		const pending: CanvasRects | null = null;
		expect(acknowledgeCanvasRects(pending, layout())).toBeNull();
	});

	it("lets resized outlines adopt renderer geometry when the size estimate differs", () => {
		const resized = { ...display, awaitingPosition: false, w: 0.5 };
		expect(acknowledgeCanvasRects({ display: resized }, layout())).toBeNull();
	});
});
