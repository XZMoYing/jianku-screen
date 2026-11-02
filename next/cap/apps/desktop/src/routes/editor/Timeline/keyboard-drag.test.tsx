import { createSignal, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { render } from "solid-js/web";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { KeyboardTrackSegment } from "~/utils/tauri";
import { createStoreHistory } from "../project-history";
import { TimelineContextProvider } from "./context";
import { KeyboardTrack } from "./KeyboardTrack";

vi.mock("../context", () => ({ useEditorContext: () => context }));
vi.mock("~/utils/i18n", () => ({ t: (value: string) => value }));

function segment(id: string, start: number): KeyboardTrackSegment {
	return { id, start, end: start + 4, displayText: id, keys: [] };
}

function fixture(segments: KeyboardTrackSegment[]) {
	const [project, setProject] = createStore({
		timeline: { keyboardSegments: segments },
	});
	const [editorState, setEditorState] = createStore({
		previewTime: null as number | null,
		playbackTime: 0,
		timeline: {
			interactMode: "seek",
			transform: { position: 0, zoom: 60 },
			selection: null as { type: "keyboard"; indices: number[] } | null,
			hoveredTrack: null as string | null,
		},
	});
	const history = createStoreHistory(project, setProject);
	const resume = vi.fn();
	const [total, setTotal] = createSignal(60);
	const [scale, setScale] = createSignal(0.01);
	return {
		project,
		setProject,
		editorState,
		setEditorState,
		resume,
		totalDuration: total,
		scale,
		setScale,
		setTotal,
		projectHistory: {
			...history,
			pause: vi.fn(() => {
				const finish = history.pause();
				return () => {
					resume();
					finish();
				};
			}),
		},
		projectActions: { splitKeyboardSegment: vi.fn() },
	};
}

let context: ReturnType<typeof fixture>;
let dispose: (() => void) | undefined;
beforeEach(() => {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
});
afterEach(() => {
	mouse(window, "mouseup", 200, 0);
	dispose?.();
	dispose = undefined;
	document.body.innerHTML = "";
	vi.unstubAllGlobals();
});

function mount(segments = [segment("A", 2), segment("B", 10)]) {
	const [shown, setShown] = createSignal(true);
	const onDragStateChanged = vi.fn();
	const handleUpdatePlayhead = vi.fn();
	dispose = render(() => {
		context = fixture(segments);
		return (
			<TimelineContextProvider
				duration={context.totalDuration()}
				secsPerPixel={context.scale()}
				timelineBounds={{
					left: 0,
					top: 0,
					right: 1000,
					bottom: 44,
					width: 1000,
					height: 44,
				}}
			>
				<Show when={shown()}>
					<KeyboardTrack {...{ onDragStateChanged, handleUpdatePlayhead }} />
				</Show>
			</TimelineContextProvider>
		);
	}, document.body);
	const root = document.querySelector('[data-keyboard-segment][title="A"]');
	const content = root?.querySelector(".cursor-grab");
	if (!(root instanceof HTMLElement) || !(content instanceof HTMLElement))
		throw new Error("Missing keyboard segment");
	return { root, content, setShown, onDragStateChanged, handleUpdatePlayhead };
}

function mouse(
	target: EventTarget,
	type: string,
	x: number,
	buttons = 1,
	button = 0,
) {
	target.dispatchEvent(
		new MouseEvent(type, { bubbles: true, clientX: x, buttons, button }),
	);
}

function begin(content: HTMLElement) {
	mouse(content, "mousedown", 200);
	mouse(window, "mousemove", 203);
	mouse(window, "mousemove", 303);
}

it("writes the visible keyboard segment without corrupting a filtered source entry", () => {
	const f = mount([segment("Hidden", 70), segment("A", 2)]);
	begin(f.content);
	mouse(window, "mouseup", 353, 0);
	expect(context.project.timeline.keyboardSegments[0]).toMatchObject({
		id: "Hidden",
		start: 70,
		end: 74,
	});
	expect(context.project.timeline.keyboardSegments[1].id).toBe("A");
	expect(context.project.timeline.keyboardSegments[1].start).toBeCloseTo(
		3.53,
		10,
	);
	expect(context.project.timeline.keyboardSegments[1].end).toBeCloseTo(
		7.53,
		10,
	);
	expect(document.querySelector('[data-keyboard-segment][title="A"]')).toBe(
		f.root,
	);
});

it("uses source indices for selection and split actions after filtering", () => {
	const f = mount([segment("Hidden", 70), segment("A", 2)]);
	mouse(f.content, "mousedown", 200);
	mouse(window, "mouseup", 200, 0);
	expect(context.editorState.timeline.selection).toEqual({
		type: "keyboard",
		indices: [1],
	});
	context.setEditorState("timeline", "interactMode", "split");
	vi.spyOn(f.root, "getBoundingClientRect").mockReturnValue(
		new DOMRect(100, 0, 400, 44),
	);
	mouse(f.root, "mousedown", 200);
	expect(context.projectActions.splitKeyboardSegment.mock.calls).toEqual([
		[1, 1],
	]);
});

it.each([
	"blur",
	"escape",
	"unmount",
	"mode",
	"delete",
	"replace",
	"buttons",
	"scale",
	"duration",
] as const)("ends on %s and ignores subsequent mouse events", (reason) => {
	const f = mount();
	begin(f.content);
	if (reason === "blur") window.dispatchEvent(new Event("blur"));
	if (reason === "escape")
		document.body.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
	if (reason === "unmount") f.setShown(false);
	if (reason === "mode")
		context.setEditorState("timeline", "interactMode", "split");
	if (reason === "delete")
		context.setProject("timeline", "keyboardSegments", []);
	if (reason === "replace")
		context.setProject(
			"timeline",
			"keyboardSegments",
			0,
			segment("Replacement", 30),
		);
	if (reason === "buttons") mouse(window, "mousemove", 303, 0);
	if (reason === "scale") context.setScale(0.02);
	if (reason === "duration") context.setTotal(50);
	const before = JSON.stringify(context.project);
	const resumesAtInterruption = context.resume.mock.calls.length;
	mouse(window, "mousemove", 503);
	mouse(window, "mouseup", 603, 0);
	expect(JSON.stringify(context.project)).toBe(before);
	expect(resumesAtInterruption).toBe(1);
	expect(context.resume).toHaveBeenCalledTimes(1);
	expect(f.onDragStateChanged).toHaveBeenLastCalledWith({ type: "idle" });
	expect(f.handleUpdatePlayhead).not.toHaveBeenCalled();
});

it("ignores non-primary gestures and keeps a drag active after a non-primary release", () => {
	const f = mount();
	mouse(f.content, "mousedown", 200, 2, 2);
	expect(context.projectHistory.pause).not.toHaveBeenCalled();
	begin(f.content);
	mouse(window, "mouseup", 303, 1, 2);
	expect(context.resume).not.toHaveBeenCalled();
	mouse(window, "mouseup", 403, 0);
	expect(context.project.timeline.keyboardSegments[0].start).toBeCloseTo(4.03);
	expect(context.resume).toHaveBeenCalledTimes(1);
});

it("commits the release coordinate as one undoable edit and ends before a history shortcut", () => {
	const f = mount();
	begin(f.content);
	document.body.dispatchEvent(
		new KeyboardEvent("keydown", {
			code: "KeyZ",
			key: "z",
			metaKey: true,
			bubbles: true,
		}),
	);
	expect(context.project.timeline.keyboardSegments[0].start).toBe(2);
	mouse(window, "mousemove", 503);
	mouse(window, "mouseup", 603, 0);
	expect(context.project.timeline.keyboardSegments[0].start).toBe(2);
	expect(context.projectHistory.canRedo()).toBe(true);
	context.projectHistory.redo();
	expect(context.project.timeline.keyboardSegments[0].start).toBeCloseTo(3.03);
	expect(context.resume).toHaveBeenCalledTimes(1);
});

it("preserves non-position edits while continuing a drag", () => {
	const f = mount();
	begin(f.content);
	context.setProject(
		"timeline",
		"keyboardSegments",
		0,
		"displayText",
		"Latest",
	);
	mouse(window, "mousemove", 403);
	mouse(window, "mouseup", 403, 0);
	expect(context.project.timeline.keyboardSegments[0]).toMatchObject({
		id: "A",
		displayText: "Latest",
	});
	expect(context.project.timeline.keyboardSegments[0].start).toBeCloseTo(
		4.03,
		10,
	);
	expect(context.project.timeline.keyboardSegments[0].end).toBeCloseTo(
		8.03,
		10,
	);
});

it.each(["start", "end"] as const)(
	"commits the %s trim at the primary release coordinate",
	(edge) => {
		const f = mount();
		const handles = f.root.querySelectorAll("[data-compact]");
		const handle = handles[edge === "start" ? 0 : 1];
		if (!handle) throw new Error("Missing keyboard handle");
		mouse(handle, "mousedown", 200);
		mouse(window, "mousemove", 203);
		mouse(window, "mousemove", 253);
		mouse(window, "mouseup", 303, 0);
		expect(context.project.timeline.keyboardSegments[0][edge]).toBeCloseTo(
			edge === "start" ? 3.03 : 7.03,
			10,
		);
		expect(context.resume).toHaveBeenCalledTimes(1);
	},
);

it("does not add a history entry for an ordinary selection click", () => {
	const f = mount();
	mouse(f.content, "mousedown", 200);
	mouse(window, "mouseup", 200, 0);
	expect(context.editorState.timeline.selection).toEqual({
		type: "keyboard",
		indices: [0],
	});
	expect(context.projectHistory.canUndo()).toBe(false);
});

it("applies the full pointer distance when a fast drag delivers only one move event", () => {
	const f = mount();
	mouse(f.content, "mousedown", 200);
	mouse(window, "mousemove", 600);
	mouse(window, "mouseup", 600, 0);
	expect(context.project.timeline.keyboardSegments[0]).toMatchObject({
		start: 6,
		end: 10,
	});
});

it("does not add a history entry when the drag is clamped without changing the segment", () => {
	const f = mount([segment("A", 0), segment("B", 4)]);
	begin(f.content);
	mouse(window, "mouseup", 303, 0);
	expect(context.project.timeline.keyboardSegments[0]).toMatchObject({
		start: 0,
		end: 4,
	});
	expect(context.projectHistory.canUndo()).toBe(false);
});
