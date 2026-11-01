import { createSignal, Show } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { render } from "solid-js/web";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAudioTrackSegment } from "../audio";
import { defaultMaskSegment } from "../masks";
import { defaultTextSegment } from "../text";
import { sortTrackSegments } from "../timelineTracks";
import { AudioTrack } from "./AudioTrack";
import { TimelineContextProvider } from "./context";
import { MaskTrack } from "./MaskTrack";
import { TextTrack } from "./TextTrack";

vi.mock("../context", () => ({ useEditorContext: () => context }));
vi.mock("~/utils/i18n", () => ({ t: (value: string) => value }));

type Kind = "text" | "mask" | "audio";
function fixture() {
	const [project, setProject] = createStore({
		timeline: {
			textSegments: [defaultTextSegment(2, 6), defaultTextSegment(10, 14)],
			maskSegments: [defaultMaskSegment(2, 6), defaultMaskSegment(10, 14)],
			audioSegments: [2, 10].map((start, index) =>
				createAudioTrackSegment({
					start,
					end: start + 4,
					track: 0,
					path: `/synthetic/${index}.wav`,
					name: index === 0 ? "A" : "B",
					duration: 60,
				}),
			),
		},
	});
	const [editorState, setEditorState] = createStore({
		previewTime: null as number | null,
		playbackTime: 0,
		timeline: {
			interactMode: "seek",
			transform: { position: 0, zoom: 60 },
			selection: null as { type: Kind; indices: number[] } | null,
			audioPicker: null as number | null,
			hoveredTrack: null as string | null,
			hoveredMaskIndex: null as number | null,
			hoveredMaskTime: null as number | null,
		},
	});
	const resume = vi.fn();
	return {
		project,
		setProject,
		editorState,
		setEditorState,
		totalDuration: () => 60,
		projectHistory: { pause: vi.fn(() => resume) },
		resume,
		projectActions: {},
		canvasControls: () => undefined,
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
function mount(kind: Kind) {
	context = fixture();
	const onDragStateChanged = vi.fn();
	const handleUpdatePlayhead = vi.fn();
	const [shown, setShown] = createSignal(true);
	const [lane, setLane] = createSignal(0);
	dispose = render(
		() => (
			<TimelineContextProvider
				duration={60}
				secsPerPixel={0.01}
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
					{kind === "text" ? (
						<TextTrack
							laneIndex={lane()}
							{...{ onDragStateChanged, handleUpdatePlayhead }}
						/>
					) : kind === "mask" ? (
						<MaskTrack
							laneIndex={lane()}
							{...{ onDragStateChanged, handleUpdatePlayhead }}
						/>
					) : (
						<AudioTrack
							laneIndex={lane()}
							onRequestAdd={() => {}}
							{...{ onDragStateChanged, handleUpdatePlayhead }}
						/>
					)}
				</Show>
			</TimelineContextProvider>
		),
		document.body,
	);
	const root = document.querySelector(`[data-${kind}-segment]`);
	if (!(root instanceof HTMLElement)) throw new Error("Missing segment");
	const content = root.querySelector(".cursor-grab");
	if (!(content instanceof HTMLElement))
		throw new Error("Missing segment content");
	return {
		root,
		content,
		onDragStateChanged,
		handleUpdatePlayhead,
		setShown,
		setLane,
	};
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
for (const kind of ["text", "mask", "audio"] as const) {
	it.each(["blur", "escape", "unmount", "mode", "lane", "delete"] as const)(
		`${kind}: ends once on %s and never writes from a later mouse event`,
		(reason) => {
			const f = mount(kind);
			begin(f.content);
			if (reason === "blur") window.dispatchEvent(new Event("blur"));
			if (reason === "escape")
				window.dispatchEvent(
					new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
				);
			if (reason === "unmount") f.setShown(false);
			if (reason === "mode")
				context.setEditorState("timeline", "interactMode", "split");
			if (reason === "lane") f.setLane(1);
			if (reason === "delete")
				context.setProject("timeline", `${kind}Segments`, []);
			const saved = JSON.stringify(context.project);
			expect(context.resume).toHaveBeenCalledTimes(1);
			expect(f.onDragStateChanged).toHaveBeenLastCalledWith({ type: "idle" });
			mouse(window, "mousemove", 503);
			mouse(window, "mouseup", 603, 0);
			expect(JSON.stringify(context.project)).toBe(saved);
			expect(context.resume).toHaveBeenCalledTimes(1);
			expect(f.handleUpdatePlayhead).not.toHaveBeenCalled();
		},
	);
	it(`${kind}: preserves the segment DOM when another segment changes lanes`, () => {
		const f = mount(kind);
		const key = `${kind}Segments` as const;
		context.setProject(
			"timeline",
			key,
			produce((items) => {
				items[1].track = 1;
				sortTrackSegments<{ start: number; end: number; track: number }>(items);
			}),
		);
		const before = document.querySelector(`[data-${kind}-segment]`);
		expect(before).toBe(f.root);
	});
}
it("audio: continues moving the original segment through sorting, preserving the other segment", () => {
	const f = mount("audio");
	const a = context.project.timeline.audioSegments[0];
	const b = context.project.timeline.audioSegments[1];
	context.setEditorState("timeline", "selection", {
		type: "audio",
		indices: [0],
	});
	mouse(f.content, "mousedown", 200);
	mouse(window, "mousemove", 203);
	mouse(window, "mousemove", 1403);
	mouse(window, "mousemove", 1503);
	mouse(window, "mouseup", 1503, 0);
	expect(a.start).toBe(15);
	expect(b.start).toBe(10);
	expect(context.editorState.timeline.selection).toEqual({
		type: "audio",
		indices: [1],
	});
	expect(document.querySelector('[data-audio-segment][title="A"]')).toBe(
		f.root,
	);
	expect(context.resume).toHaveBeenCalledTimes(1);
});

for (const kind of ["text", "mask", "audio"] as const) {
	it.each(["start", "end"] as const)(
		`${kind}: trims the %s edge continuously and commits the release coordinate`,
		(edge) => {
			const f = mount(kind);
			const handles = f.root.querySelectorAll("[data-compact]");
			const handle = handles[edge === "start" ? 0 : 1];
			if (!handle) throw new Error("Missing trim handle");
			mouse(handle, "mousedown", 200);
			mouse(window, "mousemove", 203);
			mouse(window, "mousemove", 253);
			mouse(window, "mouseup", 303, 0);
			const segment = context.project.timeline[`${kind}Segments`][0];
			expect(segment[edge]).toBe(edge === "start" ? 3 : 7);
			expect(context.editorState.previewTime).toBe(segment[edge]);
			expect(context.resume).toHaveBeenCalledTimes(1);
		},
	);
	it(`${kind}: retains ordinary click selection and ignores non-primary gestures`, () => {
		const f = mount(kind);
		mouse(f.content, "mousedown", 200, 2, 2);
		expect(context.projectHistory.pause).not.toHaveBeenCalled();
		mouse(f.content, "mousedown", 200);
		mouse(window, "mouseup", 200, 1, 2);
		expect(context.resume).not.toHaveBeenCalled();
		mouse(window, "mouseup", 200, 0);
		expect(context.editorState.timeline.selection).toEqual({
			type: kind,
			indices: [0],
		});
		expect(f.handleUpdatePlayhead).toHaveBeenCalledTimes(1);
		expect(context.resume).toHaveBeenCalledTimes(1);
	});
	it(`${kind}: ends a lost release and replaces a previous drag without leaking history`, () => {
		const f = mount(kind);
		begin(f.content);
		mouse(f.content, "mousedown", 303);
		expect(context.resume).toHaveBeenCalledTimes(1);
		mouse(window, "mousemove", 503, 0);
		expect(context.resume).toHaveBeenCalledTimes(2);
		const saved = JSON.stringify(context.project);
		mouse(window, "mousemove", 603);
		mouse(window, "mouseup", 603, 0);
		expect(JSON.stringify(context.project)).toBe(saved);
		expect(context.resume).toHaveBeenCalledTimes(2);
	});
}
it.each(["blur", "escape", "unmount", "mode", "delete"] as const)(
	"audio fade: releases history on %s and stops stale updates",
	(reason) => {
		const f = mount("audio");
		const fill = f.root.querySelector(".cap-track-fill");
		if (!(fill instanceof HTMLElement)) throw new Error("Missing audio fill");
		vi.spyOn(fill, "getBoundingClientRect").mockReturnValue(
			new DOMRect(0, 0, 400, 44),
		);
		const corner = fill.querySelector('[aria-label="淡入控制点"]');
		if (!corner) throw new Error("Missing fade handle");
		mouse(corner, "mousedown", 100);
		mouse(window, "mousemove", 200);
		expect(context.project.timeline.audioSegments[0].fadeIn).toBe(2);
		if (reason === "blur") window.dispatchEvent(new Event("blur"));
		if (reason === "escape")
			window.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
		if (reason === "unmount") f.setShown(false);
		if (reason === "mode")
			context.setEditorState("timeline", "interactMode", "split");
		if (reason === "delete")
			context.setProject("timeline", "audioSegments", []);
		const saved = JSON.stringify(context.project);
		expect(context.resume).toHaveBeenCalledTimes(1);
		mouse(window, "mousemove", 300);
		mouse(window, "mouseup", 300, 0);
		expect(JSON.stringify(context.project)).toBe(saved);
		expect(context.resume).toHaveBeenCalledTimes(1);
	},
);
