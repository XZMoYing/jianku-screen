import {
	createEventListener,
	createEventListenerMap,
} from "@solid-primitives/event-listener";
import { render } from "solid-js/web";
import { afterEach, expect, it } from "vitest";
import { createTimelineHoverPreview } from "./hover-preview";

let dispose: (() => void) | undefined;
afterEach(() => {
	dispose?.();
	dispose = undefined;
	document.body.innerHTML = "";
});
function fixture() {
	const trace: (number | null)[] = [];
	let pointerDown = false;
	let playing = false;
	let dragging = false;
	let container: HTMLDivElement | undefined;
	let button: HTMLButtonElement | undefined;
	dispose = render(() => {
		createEventListener(
			window,
			"mousedown",
			(event) => {
				if (event.button === 0 && event.target instanceof Node)
					pointerDown = container?.contains(event.target) ?? false;
			},
			{ capture: true },
		);
		createEventListenerMap(window, {
			mouseup: () => {
				pointerDown = false;
				dragging = false;
			},
			blur: () => {
				pointerDown = false;
				dragging = false;
			},
			mousemove: () => {
				if (dragging) trace.push(4);
			},
		});
		const hover = createTimelineHoverPreview({
			pointerDown: () => pointerDown,
			playbackIntent: () => playing,
			metrics: () => ({ left: 100, width: 800 }),
			position: () => 0,
			secondsPerPixel: () => 0.01,
			startSnapPixels: 8,
			setPreviewTime: (value) => trace.push(value),
		});
		return (
			<div
				ref={container}
				onMouseMove={hover.onMouseMove}
				onMouseLeave={hover.onMouseLeave}
			>
				<button
					ref={button}
					type="button"
					onMouseDown={(event) => {
						event.stopPropagation();
						dragging = true;
					}}
				>
					trim
				</button>
			</div>
		);
	}, document.body);
	if (!container || !button) throw new Error("Missing timeline fixture");
	return {
		container,
		button,
		trace,
		play: () => {
			playing = true;
		},
	};
}
function mouse(target: EventTarget, type: string, buttons: number, x = 700) {
	target.dispatchEvent(
		new MouseEvent(type, { bubbles: true, button: 0, buttons, clientX: x }),
	);
}
it("lets a trim own preview time throughout bubbling movement and leaving the timeline", () => {
	const f = fixture();
	mouse(f.button, "mousedown", 1);
	mouse(f.button, "mousemove", 1);
	mouse(f.container, "mouseleave", 1);
	mouse(window, "mousemove", 1, 950);
	expect(f.trace).toEqual([4, 4]);
});
it("resumes hover after release without a queued second seek", () => {
	const f = fixture();
	mouse(f.button, "mousedown", 1);
	mouse(f.button, "mousemove", 1);
	mouse(window, "mouseup", 0);
	expect(f.trace).toEqual([4]);
	mouse(f.button, "mousemove", 0);
	expect(f.trace).toEqual([4, 6]);
});
it("preserves captured ownership even if a movement reports no buttons", () => {
	const f = fixture();
	mouse(f.button, "mousedown", 1);
	mouse(f.button, "mousemove", 0);
	mouse(f.container, "mouseleave", 0);
	expect(f.trace).toEqual([4]);
});
it.each([1, 2, 4])(
	"ignores hover while button mask %s is held outside the timeline",
	(buttons) => {
		const f = fixture();
		mouse(f.button, "mousemove", buttons);
		mouse(f.container, "mouseleave", buttons);
		expect(f.trace).toEqual([]);
	},
);
it("keeps ordinary start snapping and outside clearing", () => {
	const f = fixture();
	mouse(f.button, "mousemove", 0, 102);
	mouse(f.button, "mousemove", 0, 950);
	mouse(f.container, "mouseleave", 0);
	expect(f.trace).toEqual([0, null, null]);
});
it("does not scrub during playback and recovers after window blur", () => {
	const f = fixture();
	mouse(f.button, "mousedown", 1);
	window.dispatchEvent(new Event("blur"));
	mouse(f.button, "mousemove", 0);
	expect(f.trace).toEqual([6]);
	f.play();
	mouse(f.button, "mousemove", 0, 500);
	expect(f.trace).toEqual([6]);
});
