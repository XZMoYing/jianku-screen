import { Menu } from "@tauri-apps/api/menu";
import { batch, createSignal, Show } from "solid-js";
import { createStore, produce, unwrap } from "solid-js/store";
import { render } from "solid-js/web";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ZoomSegment } from "~/utils/tauri";
import { createStoreHistory } from "../project-history";
import { TimelineContextProvider } from "./context";
import { ZoomTrack } from "./ZoomTrack";

vi.mock("../context", () => ({
	useEditorContext: () => context,
	serializeProjectConfiguration: (value: object) => value,
}));
vi.mock("~/utils/i18n", () => ({ t: (value: string) => value }));
vi.mock("~/store", () => ({
	generalSettingsStore: {
		createQuery: () => ({ data: { defaultZoomAmount: 2 } }),
	},
}));
vi.mock("~/utils/tauri", () => ({
	commands: { generateZoomSegmentsFromClicks: vi.fn(async () => []) },
}));
vi.mock("@tauri-apps/api/menu", () => ({
	Menu: { new: vi.fn(async () => ({ popup: vi.fn() })) },
}));

function segment(start: number, end = start + 4): ZoomSegment {
	return {
		start,
		end,
		amount: 2,
		mode: "auto",
		glideDirection: "none",
		glideSpeed: 0.5,
		instantAnimation: false,
		edgeSnapRatio: 0.25,
	};
}
function fixture(segments: ZoomSegment[]) {
	const [project, setProject] = createStore({
		timeline: { zoomSegments: segments },
	});
	const [editorState, setEditorState] = createStore({
		previewTime: null as number | null,
		playbackTime: 0,
		timeline: {
			interactMode: "seek",
			transform: { position: 0, zoom: 60 },
			selection: null as { type: "zoom"; indices: number[] } | null,
			hoveredTrack: null as string | null,
		},
	});
	const history = createStoreHistory(project, setProject);
	let resumes = 0;
	const [total, setTotal] = createSignal(60);
	const [scale, setScale] = createSignal(0.01);
	return {
		project,
		setProject,
		editorState,
		setEditorState,
		totalDuration: total,
		setTotal,
		scale,
		setScale,
		projectHistory: {
			...history,
			pause: vi.fn(() => {
				const finish = history.pause();
				return () => {
					resumes++;
					finish();
				};
			}),
		},
		counts: () => ({ resumes }),
		meta: () => ({ hasRecordedCursorData: false }),
		flushProjectConfig: async () => {},
		projectRevision: () => 0,
		projectActions: { splitZoomSegment: vi.fn(), deleteZoomSegments: vi.fn() },
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
const roots = () => [
	...document.querySelectorAll<HTMLElement>('[title^="自动缩放"]'),
];
function mount(segments = [segment(2), segment(10)]) {
	const [shown, setShown] = createSignal(true);
	const onDragStateChanged = vi.fn();
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
					<ZoomTrack
						onDragStateChanged={onDragStateChanged}
						handleUpdatePlayhead={() => {}}
					/>
				</Show>
			</TimelineContextProvider>
		);
	}, document.body);
	const lane = document.body.firstElementChild;
	if (!(lane instanceof HTMLElement)) throw new Error("Missing zoom lane");
	return { setShown, lane, onDragStateChanged };
}
function content(index = 0) {
	const node = roots()[index]?.querySelector(".cursor-grab");
	if (!(node instanceof HTMLElement)) throw new Error("Missing zoom content");
	return node;
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
function begin(node: HTMLElement) {
	mouse(node, "mousedown", 200);
	mouse(window, "mousemove", 250);
	mouse(window, "mousemove", 300);
}

it.each([
	"blur",
	"escape",
	"unmount",
	"mode",
	"range",
	"buttons",
	"scale",
	"duration",
] as const)("existing zoom ends on %s", (reason) => {
	const f = mount();
	begin(content());
	if (reason === "blur") window.dispatchEvent(new Event("blur"));
	if (reason === "escape")
		document.body.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
	if (reason === "unmount") f.setShown(false);
	if (reason === "mode")
		context.setEditorState("timeline", "interactMode", "split");
	if (reason === "range")
		context.setProject("timeline", "zoomSegments", 0, { start: 30, end: 34 });
	if (reason === "buttons") mouse(window, "mousemove", 300, 0);
	if (reason === "scale") context.setScale(0.02);
	if (reason === "duration") context.setTotal(50);
	const before = JSON.stringify(context.project);
	const resumed = context.counts().resumes;
	mouse(window, "mousemove", 400);
	mouse(window, "mouseup", 500, 0);
	expect(JSON.stringify(context.project)).toBe(before);
	expect(resumed).toBe(1);
	expect(context.counts().resumes).toBe(1);
	expect(f.onDragStateChanged).toHaveBeenLastCalledWith({ type: "idle" });
});
it("continues the same zoom after sorting and preserves its DOM and selection", () => {
	mount();
	const node = roots()[0];
	const a = context.project.timeline.zoomSegments[0];
	const b = context.project.timeline.zoomSegments[1];
	context.setEditorState("timeline", "selection", {
		type: "zoom",
		indices: [0],
	});
	begin(content());
	batch(() => {
		context.setProject(
			"timeline",
			"zoomSegments",
			produce((items) => {
				items[1].start = 0;
				items[1].end = 1;
				items.sort((left, right) => left.start - right.start);
			}),
		);
		context.setEditorState("timeline", "selection", {
			type: "zoom",
			indices: [1],
		});
	});
	mouse(window, "mousemove", 400);
	mouse(window, "mouseup", 500, 0);
	expect(a.start).toBe(5);
	expect(a.end).toBe(9);
	expect(b.start).toBe(0);
	expect(b.end).toBe(1);
	expect(roots()[1]).toBe(node);
	expect(context.editorState.timeline.selection?.indices).toEqual([1]);
});
it("uses down coordinates for coalesced movement and commits the release", () => {
	mount();
	mouse(content(), "mousedown", 200);
	mouse(window, "mousemove", 500);
	mouse(window, "mouseup", 600, 0);
	expect(context.project.timeline.zoomSegments[0]).toMatchObject({
		start: 6,
		end: 10,
	});
});
it("does not create no-op history from clicking or a clamped move", () => {
	mount([segment(0), segment(4)]);
	mouse(content(), "mousedown", 200);
	mouse(window, "mouseup", 200, 0);
	expect(context.projectHistory.canUndo()).toBe(false);
	begin(content());
	mouse(window, "mouseup", 500, 0);
	expect(context.projectHistory.canUndo()).toBe(false);
});
it("finishes before undo and ignores late mouse input", () => {
	mount();
	begin(content());
	document.body.dispatchEvent(
		new KeyboardEvent("keydown", {
			key: "z",
			code: "KeyZ",
			metaKey: true,
			bubbles: true,
		}),
	);
	expect(context.project.timeline.zoomSegments[0].start).toBe(2);
	mouse(window, "mousemove", 400);
	mouse(window, "mouseup", 500, 0);
	expect(context.project.timeline.zoomSegments[0].start).toBe(2);
	context.projectHistory.redo();
	expect(context.project.timeline.zoomSegments[0].start).toBe(3);
});
it.each(["start", "end"] as const)(
	"trims %s while preserving zoom parameters",
	(edge) => {
		mount();
		const before = structuredClone(
			unwrap(context.project.timeline.zoomSegments[0]),
		);
		const handle =
			roots()[0].querySelectorAll("[data-compact]")[edge === "start" ? 0 : 1];
		begin(handle as HTMLElement);
		mouse(window, "mouseup", 300, 0);
		expect(context.project.timeline.zoomSegments[0][edge]).toBe(
			edge === "start" ? 3 : 7,
		);
		const { start, end, ...parameters } =
			context.project.timeline.zoomSegments[0];
		const { start: oldStart, end: oldEnd, ...oldParameters } = before;
		expect(parameters).toEqual(oldParameters);
		expect(start < end && oldStart < oldEnd).toBe(true);
	},
);
it("keeps adjacent end boundaries and ignores non-primary release", () => {
	mount([segment(2), segment(6)]);
	const handle = roots()[0].querySelectorAll("[data-compact]")[1];
	begin(handle as HTMLElement);
	mouse(window, "mouseup", 400, 1, 2);
	expect(context.counts().resumes).toBe(0);
	mouse(window, "mouseup", 500, 0);
	expect(context.project.timeline.zoomSegments[0].end).toBe(6);
	handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
	expect(context.project.timeline.zoomSegments[0].end).toBe(6);
});
it.each([
	"blur",
	"escape",
	"unmount",
	"mode",
	"buttons",
	"scale",
	"duration",
] as const)("uncreated drawing cancels on %s", (reason) => {
	const f = mount([]);
	context.setEditorState("timeline", "hoveredTrack", "zoom");
	context.setEditorState("previewTime", 4);
	mouse(f.lane, "mousedown", 200);
	if (reason === "blur") window.dispatchEvent(new Event("blur"));
	if (reason === "escape")
		document.body.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
	if (reason === "unmount") f.setShown(false);
	if (reason === "mode")
		context.setEditorState("timeline", "interactMode", "split");
	if (reason === "buttons") mouse(window, "mousemove", 200, 0);
	if (reason === "scale") context.setScale(0.02);
	if (reason === "duration") context.setTotal(50);
	mouse(window, "mousemove", 400);
	mouse(window, "mouseup", 500, 0);
	expect(context.project.timeline.zoomSegments).toEqual([]);
	expect(context.projectHistory.canUndo()).toBe(false);
});
it("previews live creation, shrinks back and commits the primary release as one edit", () => {
	const f = mount([]);
	context.setEditorState("timeline", "hoveredTrack", "zoom");
	context.setEditorState("previewTime", 4);
	mouse(f.lane, "mousedown", 200);
	mouse(window, "mousemove", 600);
	expect(context.project.timeline.zoomSegments[0]).toMatchObject({
		start: 4,
		end: 8,
		amount: 2,
	});
	mouse(window, "mousemove", 250);
	expect(context.project.timeline.zoomSegments[0].end).toBe(5);
	mouse(window, "mouseup", 500, 1, 2);
	expect(context.counts().resumes).toBe(0);
	mouse(window, "mouseup", 500, 0);
	expect(context.project.timeline.zoomSegments[0].end).toBe(7);
	context.projectHistory.undo();
	expect(context.project.timeline.zoomSegments).toEqual([]);
});
it("retains an already created zoom at the last valid value after blur", () => {
	const f = mount([]);
	context.setEditorState("timeline", "hoveredTrack", "zoom");
	context.setEditorState("previewTime", 4);
	begin(f.lane);
	const before = JSON.stringify(context.project);
	window.dispatchEvent(new Event("blur"));
	mouse(window, "mousemove", 600);
	mouse(window, "mouseup", 600, 0);
	expect(JSON.stringify(context.project)).toBe(before);
	expect(context.counts().resumes).toBe(1);
});
it("places the default span inside the end of the timeline", () => {
	const f = mount([]);
	context.setEditorState("timeline", "hoveredTrack", "zoom");
	context.setEditorState("previewTime", 59.8);
	mouse(f.lane, "mousedown", 200);
	mouse(window, "mouseup", 200, 0);
	expect(context.project.timeline.zoomSegments[0]).toMatchObject({
		start: 59,
		end: 60,
	});
});

it("keeps non-range edits made during a drag and ends when its segment is deleted", () => {
	mount();
	begin(content());
	context.setProject("timeline", "zoomSegments", 0, "amount", 3);
	mouse(window, "mousemove", 400);
	expect(context.project.timeline.zoomSegments[0]).toMatchObject({
		start: 4,
		end: 8,
		amount: 3,
	});
	context.setProject("timeline", "zoomSegments", []);
	mouse(window, "mouseup", 500, 0);
	expect(context.project.timeline.zoomSegments).toEqual([]);
	expect(context.counts().resumes).toBe(1);
});
it("keeps creation at the last valid value if the occupied gap changes", () => {
	const f = mount([segment(10)]);
	context.setEditorState("timeline", "hoveredTrack", "zoom");
	context.setEditorState("previewTime", 4);
	begin(f.lane);
	context.setProject("timeline", "zoomSegments", 1, { start: 6, end: 10 });
	const before = JSON.stringify(context.project);
	mouse(window, "mousemove", 600);
	mouse(window, "mouseup", 600, 0);
	expect(JSON.stringify(context.project)).toBe(before);
	expect(context.counts().resumes).toBe(1);
});
it("undoes live creation before any late events and can redo its final range", () => {
	const f = mount([]);
	context.setEditorState("timeline", "hoveredTrack", "zoom");
	context.setEditorState("previewTime", 4);
	begin(f.lane);
	document.body.dispatchEvent(
		new KeyboardEvent("keydown", {
			key: "z",
			code: "KeyZ",
			metaKey: true,
			bubbles: true,
		}),
	);
	expect(context.project.timeline.zoomSegments).toEqual([]);
	mouse(window, "mousemove", 600);
	mouse(window, "mouseup", 600, 0);
	expect(context.project.timeline.zoomSegments).toEqual([]);
	context.projectHistory.redo();
	expect(context.project.timeline.zoomSegments[0]).toMatchObject({
		start: 4,
		end: 5,
	});
});
it("starts one gesture at a time for different segments", () => {
	mount();
	begin(content());
	mouse(content(1), "mousedown", 200);
	mouse(window, "mousemove", 300);
	mouse(window, "mouseup", 300, 0);
	expect(context.project.timeline.zoomSegments[0].start).toBe(3);
	expect(context.project.timeline.zoomSegments[1].start).toBe(11);
	expect(context.counts().resumes).toBe(2);
	context.projectHistory.undo();
	expect(context.project.timeline.zoomSegments[0].start).toBe(3);
	expect(context.project.timeline.zoomSegments[1].start).toBe(10);
});
it("keeps single, multi and range selection on click", () => {
	mount();
	mouse(content(), "mousedown", 200);
	mouse(window, "mouseup", 200, 0);
	expect(context.editorState.timeline.selection?.indices).toEqual([0]);
	mouse(content(1), "mousedown", 200);
	window.dispatchEvent(
		new MouseEvent("mouseup", { button: 0, clientX: 200, metaKey: true }),
	);
	expect(context.editorState.timeline.selection?.indices).toEqual([0, 1]);
	mouse(content(), "mousedown", 200);
	window.dispatchEvent(
		new MouseEvent("mouseup", { button: 0, clientX: 200, shiftKey: true }),
	);
	expect(context.editorState.timeline.selection?.indices).toEqual([0, 1]);
	expect(context.projectHistory.canUndo()).toBe(false);
});
it("places a full span before a neighbour and refuses an undersized gap", () => {
	const f = mount([segment(10)]);
	context.setEditorState("timeline", "hoveredTrack", "zoom");
	context.setEditorState("previewTime", 9.8);
	mouse(f.lane, "mousedown", 200);
	mouse(window, "mouseup", 200, 0);
	expect(context.project.timeline.zoomSegments[0]).toMatchObject({
		start: 9,
		end: 10,
	});
	context.setEditorState("previewTime", 8.8);
	mouse(f.lane, "mousedown", 200);
	mouse(window, "mouseup", 200, 0);
	expect(context.project.timeline.zoomSegments[0]).toMatchObject({
		start: 8,
		end: 9,
	});
	context.setProject("timeline", "zoomSegments", 0, { start: 0, end: 8.5 });
	context.setEditorState("previewTime", 8.8);
	mouse(f.lane, "mousedown", 200);
	mouse(window, "mouseup", 200, 0);
	expect(context.project.timeline.zoomSegments.length).toBe(3);
});

it("keeps menu deletion on its original objects after sorting", async () => {
	mount();
	begin(content());
	roots()[0].dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
	await Promise.resolve();
	expect(context.counts().resumes).toBe(1);
	const menu = vi.mocked(Menu.new).mock.calls.at(-1)?.[0];
	const item = menu?.items?.find(
		(value) =>
			typeof value === "object" &&
			"id" in value &&
			value.id === "deleteZoomSegments",
	);
	if (
		!item ||
		typeof item !== "object" ||
		!("action" in item) ||
		typeof item.action !== "function"
	)
		throw new Error("Missing deletion action");
	context.setProject(
		"timeline",
		"zoomSegments",
		produce((items) => {
			items[1].start = 0;
			items[1].end = 1;
			items.sort((left, right) => left.start - right.start);
		}),
	);
	item.action("deleteZoomSegments");
	expect(context.projectActions.deleteZoomSegments).toHaveBeenCalledWith([1]);
	const before = JSON.stringify(context.project);
	mouse(window, "mousemove", 600);
	mouse(window, "mouseup", 600, 0);
	expect(JSON.stringify(context.project)).toBe(before);
});
