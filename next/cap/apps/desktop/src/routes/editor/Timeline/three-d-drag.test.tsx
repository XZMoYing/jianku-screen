import { batch, createSignal, Show } from "solid-js";
import { createStore, produce, unwrap } from "solid-js/store";
import { render } from "solid-js/web";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createStoreHistory } from "../project-history";
import {
	type Camera3DSegment,
	fitCamera3DMotionToSegment,
	newCamera3DShot,
} from "../three-d";
import { TimelineContextProvider } from "./context";
import { ThreeDTrack } from "./ThreeDTrack";

vi.mock("../context", () => ({ useEditorContext: () => context }));
vi.mock("../three-d-panel", () => ({ ShotCountPills: () => null }));
vi.mock("~/utils/i18n", () => ({ t: (value: string) => value }));

function fixture(shots: Camera3DSegment[]) {
	const [project, setProject] = createStore({
		timeline: { camera3dSegments: shots },
	});
	const [editorState, setEditorState] = createStore({
		previewTime: null as number | null,
		playbackTime: 0,
		timeline: {
			interactMode: "seek",
			transform: { position: 0, zoom: 60 },
			selection: null as { type: "3d"; indices: number[] } | null,
			hoveredTrack: null as string | null,
			camera3dAutoPreview: null as number | null,
			camera3dPose: "start" as "start" | "end",
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
		setTotal,
		setScale,
		totalDuration: total,
		scale,
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
		camera3DAutoScenePreview: () => [],
		projectActions: {
			addCamera3DShot: vi.fn(),
			addCamera3DShotRange: vi.fn(),
			applyCamera3DAutoScene: vi.fn(),
			splitCamera3DSegment: vi.fn(),
			selectCamera3DPose: vi.fn(),
		},
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

function roots() {
	return [...document.querySelectorAll<HTMLElement>('[title^="3D 镜头"]')];
}

function mount(shots = [newCamera3DShot(2, 6), newCamera3DShot(10, 14)]) {
	const [shown, setShown] = createSignal(true);
	const onDragStateChanged = vi.fn();
	const handleUpdatePlayhead = vi.fn();
	dispose = render(() => {
		context = fixture(shots);
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
					<ThreeDTrack {...{ onDragStateChanged, handleUpdatePlayhead }} />
				</Show>
			</TimelineContextProvider>
		);
	}, document.body);
	const lane = document.body.firstElementChild;
	if (!(lane instanceof HTMLElement)) throw new Error("Missing 3D lane");
	return { setShown, lane, onDragStateChanged, handleUpdatePlayhead };
}

function content(index = 0) {
	const node = roots()[index]?.querySelector(".cursor-grab");
	if (!(node instanceof HTMLElement)) throw new Error("Missing 3D content");
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
	"replace",
	"range",
	"buttons",
	"scale",
	"duration",
] as const)(
	"existing shot: ends on %s and never writes from late events",
	(reason) => {
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
		if (reason === "replace")
			context.setProject(
				"timeline",
				"camera3dSegments",
				0,
				newCamera3DShot(30, 34),
			);
		if (reason === "range")
			context.setProject("timeline", "camera3dSegments", 0, {
				start: 30,
				end: 34,
			});
		if (reason === "buttons") mouse(window, "mousemove", 300, 0);
		if (reason === "scale") context.setScale(0.02);
		if (reason === "duration") context.setTotal(50);
		const before = JSON.stringify(context.project);
		const resumed = context.resume.mock.calls.length;
		mouse(window, "mousemove", 400);
		mouse(window, "mouseup", 500, 0);
		expect(JSON.stringify(context.project)).toBe(before);
		expect(resumed).toBe(1);
		expect(context.resume).toHaveBeenCalledTimes(1);
		expect(f.onDragStateChanged).toHaveBeenLastCalledWith({ type: "idle" });
	},
);

it("keeps the dragged shot and DOM identity after a source reorder", () => {
	mount();
	const root = roots()[0];
	const a = context.project.timeline.camera3dSegments[0];
	const b = context.project.timeline.camera3dSegments[1];
	context.setEditorState("timeline", "selection", { type: "3d", indices: [0] });
	begin(content());
	batch(() => {
		context.setProject(
			"timeline",
			"camera3dSegments",
			produce((items) => {
				items[1].start = 0;
				items[1].end = 1;
				fitCamera3DMotionToSegment(items[1]);
				items.sort((left, right) => left.start - right.start);
			}),
		);
		context.setEditorState("timeline", "selection", {
			type: "3d",
			indices: [1],
		});
	});
	mouse(window, "mousemove", 400);
	mouse(window, "mouseup", 500, 0);
	expect(a.start).toBe(5);
	expect(a.end).toBe(9);
	expect(b.start).toBe(0);
	expect(b.end).toBe(1);
	expect(roots()[1]).toBe(root);
	expect(context.editorState.timeline.selection).toEqual({
		type: "3d",
		indices: [1],
	});
});

it("applies a coalesced move and release from the original down point", () => {
	mount();
	mouse(content(), "mousedown", 200);
	mouse(window, "mousemove", 600);
	mouse(window, "mouseup", 600, 0);
	expect(context.project.timeline.camera3dSegments[0].start).toBe(6);
	expect(context.project.timeline.camera3dSegments[0].end).toBe(10);
});

it("ends before a history shortcut and does not overwrite undo", () => {
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
	expect(context.project.timeline.camera3dSegments[0].start).toBe(2);
	mouse(window, "mousemove", 400);
	mouse(window, "mouseup", 500, 0);
	expect(context.project.timeline.camera3dSegments[0].start).toBe(2);
	context.projectHistory.redo();
	expect(context.project.timeline.camera3dSegments[0].start).toBe(3);
	expect(context.resume).toHaveBeenCalledTimes(1);
});

it("does not pause history for a selection click or clamped no-op", () => {
	mount([newCamera3DShot(0, 4), newCamera3DShot(4, 8)]);
	mouse(content(), "mousedown", 200);
	mouse(window, "mouseup", 200, 0);
	expect(context.projectHistory.canUndo()).toBe(false);
	begin(content());
	mouse(window, "mouseup", 500, 0);
	expect(context.project.timeline.camera3dSegments[0].start).toBe(0);
	expect(context.projectHistory.canUndo()).toBe(false);
});

it("ignores non-primary input and non-primary releases", () => {
	mount();
	mouse(content(), "mousedown", 200, 2, 2);
	expect(context.projectHistory.pause).not.toHaveBeenCalled();
	begin(content());
	mouse(window, "mouseup", 300, 1, 2);
	expect(context.resume).not.toHaveBeenCalled();
	mouse(window, "mouseup", 400, 0);
	expect(context.project.timeline.camera3dSegments[0].start).toBe(4);
});

function motionSignature(segment: Camera3DSegment) {
	const length = segment.end - segment.start;
	return {
		properties: segment.properties,
		blur: segment.blur,
		transitionIn: segment.transitionIn,
		transitionOut: segment.transitionOut,
		tracks: Object.fromEntries(
			Object.entries(segment.tracks).map(([key, frames]) => [
				key,
				frames.map((frame) => ({
					...frame,
					time: Math.round((frame.time / length) * 1e10) / 1e10,
				})),
			]),
		),
	};
}

it.each(["start", "end"] as const)(
	"resizes the %s edge without changing normalized motion or blur",
	(edge) => {
		mount();
		const a = context.project.timeline.camera3dSegments[0];
		const before = motionSignature(structuredClone(unwrap(a)));
		const handles = roots()[0].querySelectorAll("[data-compact]");
		const handle = handles[edge === "start" ? 0 : 1];
		if (!handle) throw new Error("Missing 3D handle");
		mouse(handle, "mousedown", 200);
		mouse(window, "mousemove", 300);
		mouse(window, "mouseup", 300, 0);
		expect(a[edge]).toBe(edge === "start" ? 3 : 7);
		expect(motionSignature(a)).toEqual(before);
		expect(
			Math.max(
				...Object.values(a.tracks).flatMap((keys) =>
					keys.map((key) => key.time),
				),
			),
		).toBeCloseTo(a.end - a.start, 10);
		expect(context.editorState.previewTime).toBe(a[edge]);
	},
);

it.each([
	"blur",
	"escape",
	"unmount",
	"mode",
	"buttons",
	"scale",
	"duration",
] as const)(
	"empty lane: cancels on %s without creating a shot later",
	(reason) => {
		const f = mount([]);
		context.setEditorState("timeline", "hoveredTrack", "3d");
		context.setEditorState("previewTime", 4);
		begin(f.lane);
		if (reason === "blur") window.dispatchEvent(new Event("blur"));
		if (reason === "escape")
			document.body.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
		if (reason === "unmount") f.setShown(false);
		if (reason === "mode")
			context.setEditorState("timeline", "interactMode", "split");
		if (reason === "buttons") mouse(window, "mousemove", 300, 0);
		if (reason === "scale") context.setScale(0.02);
		if (reason === "duration") context.setTotal(50);
		mouse(window, "mousemove", 400);
		mouse(window, "mouseup", 500, 0);
		expect(context.projectActions.addCamera3DShotRange).not.toHaveBeenCalled();
		expect(document.querySelector(".cap-add-shot-ghost")).toBeNull();
	},
);

it("empty lane: creates the final coalesced range once on primary release", () => {
	const f = mount([]);
	context.setEditorState("timeline", "hoveredTrack", "3d");
	context.setEditorState("previewTime", 4);
	mouse(f.lane, "mousedown", 200);
	mouse(window, "mousemove", 600);
	mouse(window, "mouseup", 600, 1, 2);
	expect(context.projectActions.addCamera3DShotRange).not.toHaveBeenCalled();
	mouse(window, "mouseup", 600, 0);
	expect(context.projectActions.addCamera3DShotRange.mock.calls).toEqual([
		[4, 12],
	]);
});

it("keeps an adjacent shot as the end trim and fill boundary", () => {
	mount([newCamera3DShot(2, 6), newCamera3DShot(6, 10)]);
	const handle = roots()[0].querySelectorAll("[data-compact]")[1];
	if (!handle) throw new Error("Missing 3D end handle");
	mouse(handle, "mousedown", 200);
	mouse(window, "mousemove", 250);
	mouse(window, "mouseup", 300, 0);
	expect(context.project.timeline.camera3dSegments[0].end).toBe(6);
	handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
	expect(context.project.timeline.camera3dSegments[0].end).toBe(6);
	expect(context.projectHistory.canUndo()).toBe(false);
});

it("does not resurrect a removed shot from a late event", () => {
	mount();
	begin(content());
	context.setProject("timeline", "camera3dSegments", []);
	mouse(window, "mousemove", 400);
	mouse(window, "mouseup", 500, 0);
	expect(context.project.timeline.camera3dSegments).toEqual([]);
	expect(context.resume).toHaveBeenCalledTimes(1);
});

it("keeps only the most recent shot gesture active", () => {
	mount();
	const a = context.project.timeline.camera3dSegments[0];
	const b = context.project.timeline.camera3dSegments[1];
	begin(content());
	const firstPosition = a.start;
	mouse(content(1), "mousedown", 400);
	mouse(window, "mousemove", 500);
	mouse(window, "mouseup", 600, 0);
	expect(a.start).toBe(firstPosition);
	expect(b.start).toBe(12);
	expect(context.resume).toHaveBeenCalledTimes(2);
});

it("preserves current pose and blur edits during a body move", () => {
	mount();
	begin(content());
	context.setProject(
		"timeline",
		"camera3dSegments",
		0,
		"properties",
		"roll",
		12,
	);
	context.setProject(
		"timeline",
		"camera3dSegments",
		0,
		"blur",
		"strength",
		0.73,
	);
	mouse(window, "mousemove", 400);
	mouse(window, "mouseup", 400, 0);
	expect(context.project.timeline.camera3dSegments[0].start).toBe(4);
	expect(context.project.timeline.camera3dSegments[0].properties.roll).toBe(12);
	expect(context.project.timeline.camera3dSegments[0].blur.strength).toBe(0.73);
});

it("cancels a draft range when the occupied shot list changes", () => {
	const f = mount([]);
	context.setEditorState("timeline", "hoveredTrack", "3d");
	context.setEditorState("previewTime", 4);
	begin(f.lane);
	context.setProject("timeline", "camera3dSegments", [newCamera3DShot(20, 24)]);
	mouse(window, "mousemove", 400);
	mouse(window, "mouseup", 500, 0);
	expect(context.projectActions.addCamera3DShotRange).not.toHaveBeenCalled();
	expect(f.onDragStateChanged).toHaveBeenLastCalledWith({ type: "idle" });
});

it("keeps range selection, modifier selection and pose controls working", () => {
	mount();
	context.setEditorState("timeline", "selection", { type: "3d", indices: [0] });
	mouse(content(1), "mousedown", 200);
	window.dispatchEvent(
		new MouseEvent("mouseup", {
			bubbles: true,
			clientX: 200,
			button: 0,
			buttons: 0,
			shiftKey: true,
		}),
	);
	expect(context.editorState.timeline.selection).toEqual({
		type: "3d",
		indices: [0, 1],
	});
	mouse(content(), "mousedown", 200);
	window.dispatchEvent(
		new MouseEvent("mouseup", {
			bubbles: true,
			clientX: 200,
			button: 0,
			buttons: 0,
			metaKey: true,
		}),
	);
	expect(context.editorState.timeline.selection).toEqual({
		type: "3d",
		indices: [1],
	});
	const pose = roots()[1].querySelector('[aria-label="编辑结束镜头"]');
	if (!pose) throw new Error("Missing end pose button");
	pose.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	expect(context.projectActions.selectCamera3DPose.mock.calls).toEqual([
		[1, true],
	]);
});

it("fills and undoes shot boundaries while retaining normalized keyframes", () => {
	mount();
	const a = context.project.timeline.camera3dSegments[0];
	const before = motionSignature(structuredClone(unwrap(a)));
	const handles = roots()[0].querySelectorAll("[data-compact]");
	handles[0].dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
	expect(a.start).toBe(0);
	expect(a.end).toBe(6);
	handles[1].dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
	expect(a.end).toBe(10);
	expect(motionSignature(a)).toEqual(before);
	context.projectHistory.undo();
	expect(context.project.timeline.camera3dSegments[0].start).toBe(0);
	expect(context.project.timeline.camera3dSegments[0].end).toBe(6);
});
