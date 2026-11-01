import { createSignal, Show } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { render } from "solid-js/web";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createStoreHistory } from "./project-history";
import { TextOverlay } from "./TextOverlay";
import { defaultTextSegment } from "./text";

vi.mock("./context", () => ({ FPS: 60, useEditorContext: () => context }));
vi.mock("./CanvasElementsOverlay", () => ({
	useCanvasSnapTargets: () => () => ({ v: [], h: [] }),
}));
vi.mock("~/utils/i18n", () => ({ t: (value: string) => value }));

function fixture(onRestore?: () => void) {
	const [project, setProject] = createStore({
		timeline: {
			textSegments: [defaultTextSegment(2, 6)],
			maskSegments: [],
			imageSegments: [],
			audioSegments: [{ start: 2, end: 6 }],
		},
	});
	const [editorState, setEditorState] = createStore({
		previewTime: null as number | null,
		playbackTime: 0,
		timeline: { selection: null, pendingTextEdit: null },
	});
	const projectHistory = createStoreHistory(project, setProject, onRestore);
	return {
		project,
		setProject,
		editorState,
		setEditorState,
		projectHistory,
		setSnapGuides: vi.fn(),
		projectActions: {
			deleteTextSegments: vi.fn((indices: number[]) =>
				setProject(
					"timeline",
					"textSegments",
					produce((items) => {
						for (const index of [...indices].sort((a, b) => b - a))
							items.splice(index, 1);
					}),
				),
			),
		},
	};
}
let context: ReturnType<typeof fixture>;
let dispose: (() => void) | undefined;
let measuredWidth = 80;
beforeEach(() => {
	vi.useFakeTimers();
	measuredWidth = 80;
	vi.spyOn(
		HTMLDivElement.prototype,
		"getBoundingClientRect",
	).mockImplementation(function (this: HTMLDivElement) {
		return this.style.visibility === "hidden"
			? new DOMRect(
					0,
					0,
					measuredWidth * (Number.parseFloat(this.style.fontSize) / 25),
					20 * (Number.parseFloat(this.style.fontSize) / 25),
				)
			: new DOMRect(0, 0, 1000, 562.5);
	});
});
afterEach(() => {
	mouse(window, "mouseup", 600, 300, 0);
	dispose?.();
	dispose = undefined;
	document.body.innerHTML = "";
	vi.restoreAllMocks();
	vi.useRealTimers();
});
function mount(onRestore?: () => void) {
	let setShown: ((value: boolean) => boolean) | undefined;
	let setWidth: ((value: number) => number) | undefined;
	dispose = render(() => {
		context = fixture(onRestore);
		const [shown, updateShown] = createSignal(true);
		setShown = updateShown;
		const [width, updateWidth] = createSignal(1000);
		setWidth = updateWidth;
		return (
			<Show when={shown()}>
				<TextOverlay size={{ width: width(), height: 562.5 }} />
			</Show>
		);
	}, document.body);
	return {
		setShown: (value: boolean) => setShown?.(value),
		setWidth: (value: number) => setWidth?.(value),
	};
}

function mouse(
	target: EventTarget,
	type: string,
	x: number,
	y: number,
	buttons = 1,
) {
	target.dispatchEvent(
		new MouseEvent(type, {
			bubbles: true,
			button: 0,
			buttons,
			clientX: x,
			clientY: y,
			shiftKey: true,
		}),
	);
}
function ready() {
	const f = mount();
	context.setEditorState("previewTime", 3);
	vi.advanceTimersByTime(34);
	const box = document.querySelector(".cursor-move");
	if (!(box instanceof HTMLElement)) throw new Error("Missing actual text box");
	return { ...f, box };
}
function begin(box: HTMLElement) {
	mouse(box, "mousedown", 500, 300);
	mouse(window, "mousemove", 600, 300);
	vi.advanceTimersByTime(40);
	expect(context.project.timeline.textSegments[0].center.x).toBeCloseTo(0.6);
	mouse(window, "mousemove", 700, 300);
	vi.advanceTimersByTime(17);
}
it.each([
	"blur",
	"escape",
	"unmount",
	"delete",
	"time",
	"disable",
	"resize",
	"replace",
	"undo",
] as const)(
	"ends the text move on %s and rejects both queued commits and later mouse events",
	(reason) => {
		const f = ready();
		begin(f.box);
		if (reason === "blur") window.dispatchEvent(new Event("blur"));
		if (reason === "escape")
			window.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
		if (reason === "unmount") f.setShown(false);
		if (reason === "delete") context.setProject("timeline", "textSegments", []);
		if (reason === "time") context.setEditorState("previewTime", 10);
		if (reason === "disable")
			context.setProject("timeline", "textSegments", 0, "enabled", false);
		if (reason === "resize") f.setWidth(800);
		if (reason === "replace")
			context.setProject(
				"timeline",
				"textSegments",
				produce((items) => {
					items.splice(0, 1, {
						...defaultTextSegment(2, 6),
						content: "Replacement",
					});
				}),
			);
		if (reason === "undo")
			window.dispatchEvent(
				new KeyboardEvent("keydown", {
					code: "KeyZ",
					metaKey: true,
					bubbles: true,
				}),
			);
		expect(context.projectHistory.isPaused()).toBe(false);
		const expected =
			reason === "delete"
				? undefined
				: reason === "undo" || reason === "replace"
					? 0.5
					: 0.6;
		vi.advanceTimersByTime(100);
		if (expected === undefined)
			expect(context.project.timeline.textSegments).toEqual([]);
		else
			expect(context.project.timeline.textSegments[0]?.center.x).toBeCloseTo(
				expected,
			);
		const saved = JSON.stringify(context.project);
		mouse(window, "mousemove", 900, 300);
		vi.advanceTimersByTime(100);
		mouse(window, "mouseup", 900, 300, 0);
		vi.advanceTimersByTime(100);
		expect(JSON.stringify(context.project)).toBe(saved);
	},
);
it("does not add undo history for a simple text selection click", () => {
	const f = ready();
	mouse(f.box, "mousedown", 500, 300);
	mouse(window, "mouseup", 500, 300, 0);
	expect(context.projectHistory.isPaused()).toBe(false);
	expect(context.projectHistory.canUndo()).toBe(false);
});
it("flushes the exact release position once, then preserves normal undo and redo", () => {
	const f = ready();
	begin(f.box);
	mouse(window, "mouseup", 650, 300, 0);
	vi.advanceTimersByTime(100);
	expect(context.project.timeline.textSegments[0].center.x).toBeCloseTo(0.65);
	expect(context.projectHistory.isPaused()).toBe(false);
	context.projectHistory.undo();
	vi.advanceTimersByTime(100);
	expect(context.project.timeline.textSegments[0].center.x).toBeCloseTo(0.5);
	context.projectHistory.redo();
	vi.advanceTimersByTime(100);
	expect(context.project.timeline.textSegments[0].center.x).toBeCloseTo(0.65);
});

it.each(["blur", "unmount", "replace"] as const)(
	"ends scaling on %s without a delayed font write",
	(reason) => {
		const f = ready();
		mouse(f.box, "mousedown", 500, 300);
		mouse(window, "mouseup", 500, 300, 0);
		const handle = document.querySelector(".cursor-se-resize");
		if (!(handle instanceof HTMLElement))
			throw new Error("Missing actual scale handle");
		mouse(handle, "mousedown", 500, 300);
		mouse(window, "mousemove", 540, 320);
		vi.advanceTimersByTime(40);
		expect(context.project.timeline.textSegments[0].fontSize).toBeGreaterThan(
			48,
		);
		mouse(window, "mousemove", 600, 360);
		vi.advanceTimersByTime(17);
		if (reason === "blur") window.dispatchEvent(new Event("blur"));
		if (reason === "unmount") f.setShown(false);
		if (reason === "replace")
			context.setProject(
				"timeline",
				"textSegments",
				produce((items) => {
					items.splice(0, 1, {
						...defaultTextSegment(2, 6),
						content: "Replacement",
					});
				}),
			);
		expect(context.projectHistory.isPaused()).toBe(false);
		const size = context.project.timeline.textSegments[0].fontSize;
		vi.advanceTimersByTime(100);
		mouse(window, "mousemove", 800, 500);
		mouse(window, "mouseup", 800, 500, 0);
		vi.advanceTimersByTime(100);
		expect(context.project.timeline.textSegments[0].fontSize).toBe(size);
	},
);
it("commits a normal scale release and ends its history group", () => {
	const f = ready();
	mouse(f.box, "mousedown", 500, 300);
	mouse(window, "mouseup", 500, 300, 0);
	const handle = document.querySelector(".cursor-se-resize");
	if (!(handle instanceof HTMLElement)) throw new Error("Missing scale handle");
	mouse(handle, "mousedown", 500, 300);
	mouse(window, "mousemove", 540, 320);
	vi.advanceTimersByTime(40);
	mouse(window, "mouseup", 560, 330, 0);
	vi.advanceTimersByTime(100);
	expect(context.projectHistory.isPaused()).toBe(false);
	const size = context.project.timeline.textSegments[0].fontSize;
	expect(size).toBeGreaterThan(48);
	mouse(window, "mousemove", 800, 500);
	vi.advanceTimersByTime(100);
	expect(context.project.timeline.textSegments[0].fontSize).toBe(size);
	context.projectHistory.undo();
	vi.advanceTimersByTime(100);
	expect(context.project.timeline.textSegments[0].fontSize).toBe(48);
	context.projectHistory.redo();
	vi.advanceTimersByTime(100);
	expect(context.project.timeline.textSegments[0].fontSize).toBe(size);
});

it("cannot restart a text gesture through an old detached element", () => {
	const f = ready();
	f.setShown(false);
	const saved = JSON.stringify(context.project);
	mouse(f.box, "mousedown", 500, 300);
	mouse(window, "mousemove", 700, 350);
	vi.advanceTimersByTime(100);
	mouse(window, "mouseup", 700, 350, 0);
	vi.advanceTimersByTime(100);
	expect(context.projectHistory.isPaused()).toBe(false);
	expect(JSON.stringify(context.project)).toBe(saved);
});

it("does not delete a replacement when an empty inline editor is removed", () => {
	const f = ready();
	f.box.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, button: 0 }));
	const input = document.querySelector("textarea");
	if (!(input instanceof HTMLTextAreaElement))
		throw new Error("No inline editor");
	input.value = "";
	input.dispatchEvent(new InputEvent("input", { bubbles: true }));
	context.setProject(
		"timeline",
		"textSegments",
		produce((items) => {
			items.splice(0, 1, {
				...defaultTextSegment(2, 6),
				content: "Replacement",
			});
		}),
	);
	expect(context.projectActions.deleteTextSegments).not.toHaveBeenCalled();
	expect(context.project.timeline.textSegments[0].content).toBe("Replacement");
	expect(context.projectHistory.isPaused()).toBe(false);
});

it("still deletes its own empty text after a normal inline edit", () => {
	const f = ready();
	f.box.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, button: 0 }));
	const input = document.querySelector("textarea");
	if (!(input instanceof HTMLTextAreaElement))
		throw new Error("No inline editor");
	input.value = "";
	input.dispatchEvent(new InputEvent("input", { bubbles: true }));
	input.dispatchEvent(new FocusEvent("blur"));
	expect(context.projectActions.deleteTextSegments).toHaveBeenCalledTimes(1);
	expect(context.projectActions.deleteTextSegments).toHaveBeenCalledWith([0]);
	expect(context.project.timeline.textSegments).toEqual([]);
	expect(context.projectHistory.isPaused()).toBe(false);
});

it("cleans up when a replacement context omits the text segment collection", () => {
	const f = ready();
	begin(f.box);
	expect(() =>
		context.setProject(
			"timeline",
			produce((value) => {
				Reflect.deleteProperty(value, "textSegments");
			}),
		),
	).not.toThrow();
	expect(context.projectHistory.isPaused()).toBe(false);
	vi.advanceTimersByTime(100);
	mouse(window, "mousemove", 900, 300);
	mouse(window, "mouseup", 900, 300, 0);
	expect(context.project.timeline.textSegments).toBeUndefined();
});
