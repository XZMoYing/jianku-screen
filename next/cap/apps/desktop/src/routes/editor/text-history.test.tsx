import { batch, createSignal, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { render } from "solid-js/web";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createStoreHistory } from "./project-history";
import { TextOverlay } from "./TextOverlay";
import { defaultTextSegment } from "./text";

vi.mock("./context", () => ({ FPS: 60, useEditorContext: () => context }));
vi.mock("./CanvasElementsOverlay", () => ({
	useCanvasSnapTargets: () => () => [],
}));
vi.mock("~/utils/i18n", () => ({ t: (value: string) => value }));

function fixture(onRestore?: () => void, initiallyEmpty = false) {
	const initialProject = {
		timeline: {
			textSegments: initiallyEmpty ? [] : [defaultTextSegment(2, 6)],
			maskSegments: [],
			imageSegments: [],
			audioSegments: [{ start: 2, end: 6 }],
		},
	};
	const [project, setProject] = createStore<
		typeof initialProject & { hiddenTextSegments?: number[] }
	>(initialProject);
	const [editorState, setEditorState] = createStore({
		previewTime: null as number | null,
		playbackTime: 0,
		timeline: {
			selection: null as { type: "text"; indices: number[] } | null,
			pendingTextEdit: null as number | null,
		},
	});
	const projectHistory = createStoreHistory(
		project,
		setProject,
		onRestore,
		undefined,
		undefined,
		({ hiddenTextSegments: _, ...snapshot }) => snapshot,
	);
	return {
		project,
		setProject,
		editorState,
		setEditorState,
		projectHistory,
		setSnapGuides: vi.fn(),
		projectActions: {},
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
	dispose?.();
	dispose = undefined;
	document.body.innerHTML = "";
	vi.restoreAllMocks();
	vi.useRealTimers();
});
function mount(onRestore?: () => void, initiallyEmpty = false) {
	let setShown: ((value: boolean) => boolean) | undefined;
	dispose = render(() => {
		context = fixture(onRestore, initiallyEmpty);
		const [shown, updateShown] = createSignal(true);
		setShown = updateShown;
		return (
			<Show when={shown()}>
				<TextOverlay size={{ width: 1000, height: 562.5 }} />
			</Show>
		);
	}, document.body);
	return { setShown: (value: boolean) => setShown?.(value) };
}

function createTextAndOpenInlineEditor() {
	mount(undefined, true);
	batch(() => {
		context.setProject("timeline", "textSegments", [defaultTextSegment(2, 6)]);
		context.setEditorState("previewTime", 3);
		context.setEditorState("timeline", "selection", {
			type: "text",
			indices: [0],
		});
		context.setEditorState("timeline", "pendingTextEdit", 0);
	});
	const input = document.querySelector("textarea");
	if (!input) throw new Error("Missing inline editor for new text");
	return input;
}

it("undoes new text in one step after leaving its inline editor without typing", () => {
	const input = createTextAndOpenInlineEditor();
	measuredWidth = 92;
	vi.advanceTimersByTime(20);
	input.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
	context.projectHistory.undo();
	expect(context.project.timeline.textSegments).toHaveLength(0);
	context.projectHistory.redo();
	expect(context.project.timeline.textSegments).toHaveLength(1);
});

it("keeps a typed inline edit separate from creating the text", () => {
	const input = createTextAndOpenInlineEditor();
	input.value = "Edited text";
	input.dispatchEvent(new Event("input", { bubbles: true }));
	vi.advanceTimersByTime(20);
	input.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
	expect(context.project.timeline.textSegments[0].content).toBe("Edited text");
	context.projectHistory.undo();
	expect(context.project.timeline.textSegments[0].content).toBe(
		defaultTextSegment(2, 6).content,
	);
	context.projectHistory.undo();
	expect(context.project.timeline.textSegments).toHaveLength(0);
});
it("fits measured text without adding an undo step just by visiting its time", () => {
	mount();
	expect(context.projectHistory.canUndo()).toBe(false);
	context.setEditorState("previewTime", 3);
	vi.advanceTimersByTime(20);
	expect(context.project.timeline.textSegments[0].size.x).toBeCloseTo(0.082);
	expect(context.projectHistory.canUndo()).toBe(false);
});
it("keeps redo when restored text is measured after an undo", () => {
	const f = mount();
	const resume = context.projectHistory.pause();
	context.setProject("timeline", "audioSegments", 0, { start: 11, end: 15 });
	resume();
	context.projectHistory.undo();
	expect(context.project.timeline.audioSegments[0].start).toBe(2);
	expect(context.projectHistory.canRedo()).toBe(true);
	context.setEditorState("previewTime", 3);
	vi.advanceTimersByTime(20);
	expect(context.project.timeline.textSegments[0].size.x).toBeCloseTo(0.082);
	expect(context.projectHistory.canRedo()).toBe(true);
	context.projectHistory.redo();
	expect(context.project.timeline.audioSegments[0].start).toBe(11);
	f.setShown(false);
	f.setShown(true);
	vi.advanceTimersByTime(20);
	context.projectHistory.undo();
	expect(context.project.timeline.audioSegments[0].start).toBe(2);
});
it("keeps redo through a delayed metric correction on the next animation frame", () => {
	mount();
	context.setEditorState("previewTime", 3);
	context.setProject("timeline", "audioSegments", 0, { start: 11, end: 15 });
	context.projectHistory.undo();
	measuredWidth = 90;
	vi.advanceTimersByTime(20);
	expect(context.project.timeline.textSegments[0].size.x).toBeCloseTo(0.092);
	expect(context.projectHistory.canRedo()).toBe(true);
});

it("keeps font edits undoable as one edit while retaining the measured top anchor", () => {
	mount();
	context.setEditorState("previewTime", 3);
	vi.advanceTimersByTime(20);
	const text = context.project.timeline.textSegments[0];
	const top = text.center.y - text.size.y / 2;
	context.setProject("timeline", "textSegments", 0, "fontSize", 96);
	vi.advanceTimersByTime(20);
	expect(text.size.x).toBeCloseTo(0.162);
	expect(text.center.y - text.size.y / 2).toBeCloseTo(top);
	context.projectHistory.undo();
	vi.advanceTimersByTime(20);
	expect(text.fontSize).toBe(48);
	expect(text.size.x).toBeCloseTo(0.082);
	expect(context.projectHistory.canUndo()).toBe(false);
	expect(context.projectHistory.canRedo()).toBe(true);
	context.projectHistory.redo();
	vi.advanceTimersByTime(20);
	expect(text.fontSize).toBe(96);
	expect(text.size.x).toBeCloseTo(0.162);
});
it("continues recording a real edit after a derived write and discards redo only for that edit", () => {
	mount();
	context.setProject("timeline", "audioSegments", 0, "start", 11);
	context.projectHistory.undo();
	context.projectHistory.applyDerived(() =>
		context.setProject("timeline", "textSegments", 0, "size", "x", 0.08),
	);
	expect(context.projectHistory.canRedo()).toBe(true);
	context.setProject("timeline", "audioSegments", 0, "start", 5);
	expect(context.projectHistory.canRedo()).toBe(false);
	context.projectHistory.undo();
	expect(context.project.timeline.audioSegments[0].start).toBe(2);
});
it("preserves nested drag pauses and records the final user edit once", () => {
	mount();
	const outer = context.projectHistory.pause();
	const inner = context.projectHistory.pause();
	context.setProject("timeline", "audioSegments", 0, "start", 5);
	context.projectHistory.applyDerived(() =>
		context.setProject("timeline", "textSegments", 0, "size", "x", 0.08),
	);
	inner();
	expect(context.projectHistory.isPaused()).toBe(true);
	context.setProject("timeline", "audioSegments", 0, "start", 11);
	outer();
	expect(context.projectHistory.isPaused()).toBe(false);
	context.projectHistory.undo();
	expect(context.project.timeline.audioSegments[0].start).toBe(2);
	expect(context.projectHistory.canUndo()).toBe(false);
	context.projectHistory.redo();
	expect(context.project.timeline.audioSegments[0].start).toBe(11);
});
it("restores recording after a failing nested derived callback", () => {
	mount();
	expect(() =>
		context.projectHistory.applyDerived(() => {
			context.projectHistory.applyDerived(() =>
				context.setProject("timeline", "textSegments", 0, "size", "x", 0.08),
			);
			throw new Error("fixture measurement failed");
		}),
	).toThrow("fixture measurement failed");
	context.setProject("timeline", "audioSegments", 0, "start", 5);
	context.projectHistory.undo();
	expect(context.project.timeline.audioSegments[0].start).toBe(2);
});
it("keeps keyboard undo/redo and detaches shortcuts when the editor owner is disposed", () => {
	mount();
	context.setProject("timeline", "audioSegments", 0, "start", 11);
	window.dispatchEvent(
		new KeyboardEvent("keydown", {
			code: "KeyZ",
			metaKey: true,
			bubbles: true,
		}),
	);
	expect(context.project.timeline.audioSegments[0].start).toBe(2);
	context.setEditorState("previewTime", 3);
	vi.advanceTimersByTime(20);
	window.dispatchEvent(
		new KeyboardEvent("keydown", {
			code: "KeyZ",
			metaKey: true,
			shiftKey: true,
			bubbles: true,
		}),
	);
	expect(context.project.timeline.audioSegments[0].start).toBe(11);
	dispose?.();
	dispose = undefined;
	window.dispatchEvent(
		new KeyboardEvent("keydown", {
			code: "KeyZ",
			metaKey: true,
			bubbles: true,
		}),
	);
	expect(context.project.timeline.audioSegments[0].start).toBe(11);
});

it("does not record a derived update after an enclosing batch finishes", () => {
	mount();
	context.setProject("timeline", "audioSegments", 0, "start", 11);
	context.projectHistory.undo();
	batch(() => {
		context.projectHistory.applyDerived(() =>
			context.setProject("timeline", "textSegments", 0, "size", "x", 0.08),
		);
	});
	expect(context.projectHistory.canRedo()).toBe(true);
	batch(() => {
		context.projectHistory.applyDerived(() =>
			context.setProject("timeline", "textSegments", 0, "size", "x", 0.09),
		);
		context.setProject("timeline", "audioSegments", 0, "start", 5);
	});
	expect(context.projectHistory.canRedo()).toBe(false);
	context.projectHistory.undo();
	expect(context.project.timeline.audioSegments[0].start).toBe(2);
});

it("preserves redo when the restore callback makes text visible during undo", () => {
	const restored = vi.fn(() => context.setEditorState("previewTime", 3));
	mount(restored);
	context.setProject("timeline", "audioSegments", 0, "start", 11);
	context.projectHistory.undo();
	vi.advanceTimersByTime(20);
	expect(context.project.timeline.textSegments[0].size.x).toBeCloseTo(0.082);
	expect(context.projectHistory.canRedo()).toBe(true);
	expect(restored).toHaveBeenCalledTimes(1);
	context.projectHistory.redo();
	vi.advanceTimersByTime(20);
	expect(context.project.timeline.audioSegments[0].start).toBe(11);
	expect(restored).toHaveBeenCalledTimes(2);
});

it("retains a user edit already pending in the same batch as measured layout", () => {
	mount();
	batch(() => {
		context.setProject("timeline", "audioSegments", 0, "start", 11);
		context.projectHistory.applyDerived(() =>
			context.setProject("timeline", "textSegments", 0, "size", "x", 0.08),
		);
	});
	expect(context.projectHistory.canUndo()).toBe(true);
	context.projectHistory.undo();
	expect(context.project.timeline.audioSegments[0].start).toBe(2);
	context.projectHistory.redo();
	expect(context.project.timeline.audioSegments[0].start).toBe(11);
});
