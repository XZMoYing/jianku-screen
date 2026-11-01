import { createTimelineHoverPreview } from "../../cap/apps/desktop/src/routes/editor/Timeline/hover-preview";

const parent = document.createElement("div");
const handle = document.createElement("button");
parent.append(handle);
document.body.append(parent);
const trace: (number | null)[] = [];
let held = false;
let dragging = false;
window.addEventListener(
	"mousedown",
	() => {
		held = true;
	},
	true,
);
window.addEventListener("mouseup", () => {
	held = false;
	dragging = false;
});
const hover = createTimelineHoverPreview({
	pointerDown: () => held,
	playbackIntent: () => false,
	metrics: () => ({ left: 100, width: 800 }),
	position: () => 0,
	secondsPerPixel: () => 0.01,
	startSnapPixels: 8,
	setPreviewTime: (time) => trace.push(time),
});
parent.addEventListener("mousemove", hover.onMouseMove);
parent.addEventListener("mouseleave", hover.onMouseLeave);
handle.addEventListener("mousedown", (event) => {
	event.stopPropagation();
	dragging = true;
});
window.addEventListener("mousemove", () => {
	if (dragging) trace.push(4);
});
const mouse = (target: EventTarget, type: string, buttons: number, x = 700) =>
	target.dispatchEvent(
		new MouseEvent(type, { bubbles: true, button: 0, buttons, clientX: x }),
	);
mouse(handle, "mousedown", 1);
mouse(handle, "mousemove", 1);
mouse(parent, "mouseleave", 1);
mouse(window, "mousemove", 1, 950);
const during = [...trace];
mouse(window, "mouseup", 0);
mouse(handle, "mousemove", 0);
const after = [...trace];
Object.assign(window, {
	__report: {
		during,
		after,
		passed:
			JSON.stringify(during) === "[4,4]" && JSON.stringify(after) === "[4,4,6]",
		scope:
			"real hover-preview callbacks; simulated trim endpoint; browser event routing",
	},
});
