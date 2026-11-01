import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { render } from "solid-js/web";
import { afterEach, expect, it, vi } from "vitest";
import type { FrameLayoutEvent, XY } from "~/utils/tauri";
import { CanvasElementsOverlay } from "./CanvasElementsOverlay";

vi.mock("./context", () => ({
	FPS: 60,
	useEditorContext: () => context,
}));
vi.mock("~/utils/i18n", () => ({ t: (value: string) => value }));

function fixture() {
	const [project, setProject] = createStore({
		aspectRatio: null as string | null,
		background: { padding: 10, displayPosition: null as XY<number> | null },
		camera: {
			position: { x: "right", y: "bottom" },
			manualPosition: null as XY<number> | null,
			size: 60,
		},
		timeline: {
			zoomSegments: [],
			sceneSegments: [],
			textSegments: [],
			maskSegments: [],
			imageSegments: [],
		},
	});
	const [editorState, setEditorState] = createStore({
		playing: false,
		playbackTime: 0,
		previewTime: null as number | null,
		canvasSelection: null as { type: "display" | "camera" } | null,
		timeline: { selection: null },
	});
	const [latestFrameLayout, setLayout] = createSignal<FrameLayoutEvent>({
		display: [192, 108, 1728, 972],
		camera: null,
		output_width: 1920,
		output_height: 1080,
	});
	const [styleScopeToken, setScope] = createSignal({});
	const resumeHistory = vi.fn();
	return {
		project,
		setProject,
		editorInstance: {
			recordings: { segments: [{ display: { width: 1920, height: 1080 } }] },
		},
		styleProject: project,
		setStyleProject: setProject,
		selectedStyle: () => undefined,
		toggleStyleGroup: vi.fn(),
		styleScopeToken,
		setScope,
		editorState,
		setEditorState,
		latestFrameLayout,
		setLayout,
		setSnapGuides: vi.fn(),
		projectHistory: { pause: vi.fn(() => resumeHistory) },
		resumeHistory,
	};
}
let context: ReturnType<typeof fixture>;
let dispose: (() => void) | undefined;

afterEach(() => {
	dispose?.();
	dispose = undefined;
	document.body.innerHTML = "";
	vi.useRealTimers();
});

function mount() {
	vi.useFakeTimers();
	context = fixture();
	dispose = render(
		() => <CanvasElementsOverlay size={{ width: 800, height: 450 }} />,
		document.body,
	);
}
function box(index = 0) {
	const node = document.querySelectorAll<HTMLElement>(
		".pointer-events-auto[style*='width:']",
	)[index];
	if (!node) throw new Error("Expected screen outline");
	return node;
}
function rect(index = 0) {
	const style = box(index).style;
	return {
		x: Number.parseFloat(style.left),
		y: Number.parseFloat(style.top),
		w: Number.parseFloat(style.width),
		h: Number.parseFloat(style.height),
	};
}
function mouse(target: EventTarget, type: string, x: number, y: number) {
	target.dispatchEvent(
		new MouseEvent(type, {
			bubbles: true,
			button: 0,
			clientX: x,
			clientY: y,
			shiftKey: true,
		}),
	);
	vi.advanceTimersByTime(20);
}
function moveAndRelease() {
	mouse(box(), "mousedown", 200, 200);
	mouse(window, "mousemove", 257, 231);
	mouse(window, "mouseup", 257, 231);
}
function reportRect(value: ReturnType<typeof rect>) {
	context.setLayout({
		...context.latestFrameLayout(),
		display: [
			(value.x / 800) * 1920,
			(value.y / 450) * 1080,
			((value.x + value.w) / 800) * 1920,
			((value.y + value.h) / 450) * 1080,
		],
	});
}

it("holds the released screen position until matching geometry arrives", () => {
	mount();
	moveAndRelease();
	const released = rect();
	expect(released.x).toBeCloseTo(137);
	reportRect({ ...released, x: 95, y: 50 });
	expect(rect()).toEqual(released);
	reportRect(released);
	for (const key of ["x", "y", "w", "h"] as const)
		expect(rect()[key]).toBeCloseTo(released[key]);
	reportRect({ ...released, x: 82, y: 46 });
	expect(rect().x).toBeCloseTo(82);
	expect(context.resumeHistory).toHaveBeenCalledTimes(1);
});

it("releases a pending position for a subsequent settings change", () => {
	mount();
	moveAndRelease();
	const released = rect();
	context.setProject("background", "padding", 25);
	reportRect({ ...released, x: 120, y: 70 });
	expect(rect().x).toBeCloseTo(120);
});

it("starts a second drag from the last pointer position while the renderer is behind", () => {
	mount();
	moveAndRelease();
	mouse(box(), "mousedown", 200, 200);
	mouse(window, "mouseup", 230, 220);
	expect(rect().x).toBeCloseTo(167);
	expect(rect().y).toBeCloseTo(96);
	expect(context.resumeHistory).toHaveBeenCalledTimes(2);
});

it("holds a camera drag across stale telemetry and releases it after acknowledgement", () => {
	mount();
	context.setLayout({
		...context.latestFrameLayout(),
		camera: [1344, 648, 1728, 972],
	});
	mouse(box(1), "mousedown", 600, 350);
	mouse(window, "mousemove", 570, 330);
	mouse(window, "mouseup", 570, 330);
	const released = rect(1);
	expect(released.x).toBeCloseTo(530);
	context.setLayout({
		...context.latestFrameLayout(),
		camera: [1340, 640, 1724, 964],
	});
	expect(rect(1)).toEqual(released);
	context.setLayout({
		...context.latestFrameLayout(),
		camera: [1272, 600, 1656, 924],
	});
	expect(rect(1).x).toBeCloseTo(530);
	context.setLayout({
		...context.latestFrameLayout(),
		camera: [1300, 600, 1684, 924],
	});
	expect(rect(1).x).toBeCloseTo(1300 / 2.4);
});

it("keeps an overhanging screen centered during corner resizing", () => {
	mount();
	context.setProject("background", "displayPosition", { x: 0.1, y: 0.5 });
	context.setLayout({
		...context.latestFrameLayout(),
		display: [-576, 108, 960, 972],
	});
	context.setEditorState("canvasSelection", { type: "display" });
	const corner = box().querySelector<HTMLElement>(
		"[class*='cursor-se-resize']",
	);
	if (!corner) throw new Error("Expected southeast resize handle");
	mouse(corner, "mousedown", 400, 405);
	mouse(window, "mousemove", 370, 375);
	const during = rect();
	expect(during.x).toBeLessThan(0);
	expect(during.x + during.w / 2).toBeCloseTo(80);
	expect(during.y + during.h / 2).toBeCloseTo(225);
	mouse(window, "mouseup", 370, 375);
	reportRect(during);
	expect(rect().x).toBeCloseTo(during.x);
	expect(context.project.background.displayPosition).toEqual({
		x: 0.1,
		y: 0.5,
	});
});

it.each(["time", "scope", "playback"])(
	"cancels active drag when %s changes and ignores queued mouse movement",
	(change) => {
		mount();
		mouse(box(), "mousedown", 200, 200);
		mouse(window, "mousemove", 230, 210);
		if (change === "time") context.setEditorState("playbackTime", 1);
		if (change === "scope") context.setScope({});
		if (change === "playback") context.setEditorState("playing", true);
		const position = { ...context.project.background.displayPosition };
		mouse(window, "mousemove", 400, 400);
		mouse(window, "mouseup", 400, 400);
		expect(context.project.background.displayPosition).toEqual(position);
		expect(context.resumeHistory).toHaveBeenCalledTimes(1);
	},
);

it("removes drag listeners and resumes history on blur and disposal", () => {
	mount();
	mouse(box(), "mousedown", 200, 200);
	mouse(window, "mousemove", 230, 210);
	window.dispatchEvent(new Event("blur"));
	const position = { ...context.project.background.displayPosition };
	mouse(window, "mousemove", 400, 400);
	expect(context.project.background.displayPosition).toEqual(position);
	dispose?.();
	dispose = undefined;
	mouse(window, "mouseup", 400, 400);
	expect(context.resumeHistory).toHaveBeenCalledTimes(1);
});

it("disposes an active drag without leaving history paused", () => {
	mount();
	mouse(box(), "mousedown", 200, 200);
	dispose?.();
	dispose = undefined;
	mouse(window, "mouseup", 300, 300);
	expect(context.resumeHistory).toHaveBeenCalledTimes(1);
	expect(context.project.background.displayPosition).toBeNull();
});
