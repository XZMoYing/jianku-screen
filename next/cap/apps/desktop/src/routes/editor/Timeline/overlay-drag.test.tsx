import { batch, createSignal, Show } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImageSegment, StyleSegment } from "~/utils/tauri";
import { createStoreHistory } from "../project-history";
import { defaultStyleSegment } from "../style";
import { TimelineContextProvider } from "./context";
import { ImageTrack } from "./image-track";
import { StyleTrack } from "./style-track";

vi.mock("../context", () => ({ useEditorContext: () => context }));
vi.mock("~/utils/i18n", () => ({ t: (value: string) => value }));

type Kind = "style" | "image";
function image(start: number, track = 0): ImageSegment {
	return {
		start,
		end: start + 4,
		track,
		enabled: true,
		path: "assets/test.png",
		name: "Image",
		center: { x: 0.5, y: 0.5 },
		size: { x: 0.3, y: 0.3 },
		opacity: 0.8,
		rotation: 12,
		rounding: 8,
		flipX: true,
		flipY: false,
		lockAspect: true,
	};
}
function fixture(kind: Kind) {
	const [project, setProject] = createStore({
		timeline: {
			styleSegments: [
				defaultStyleSegment(20, 24, 1),
				defaultStyleSegment(2, 6),
				defaultStyleSegment(10, 14),
			],
			imageSegments: [image(20, 1), image(2), image(10)],
		},
	});
	const [editorState, setEditorState] = createStore({
		previewTime: null as number | null,
		playbackTime: 0,
		importingImage: false,
		timeline: {
			interactMode: "seek",
			transform: { position: 0, zoom: 10 },
			selection: null as { type: Kind; indices: number[] } | null,
		},
	});
	const [scale, setScale] = createSignal(0.01);
	const [total, setTotal] = createSignal(40);
	const history = createStoreHistory(project, setProject);
	let resumes = 0;
	const items = (): (StyleSegment | ImageSegment)[] =>
		kind === "style"
			? project.timeline.styleSegments
			: project.timeline.imageSegments;
	const change = (
		index: number,
		changes: { start?: number; end?: number; track?: number; name?: string },
	) => {
		if (kind === "style")
			setProject("timeline", "styleSegments", index, changes);
		else setProject("timeline", "imageSegments", index, changes);
	};
	const reorder = () => {
		if (kind === "style")
			setProject(
				"timeline",
				"styleSegments",
				produce((values) => {
					const last = values.pop();
					if (last) values.unshift(last);
				}),
			);
		else
			setProject(
				"timeline",
				"imageSegments",
				produce((values) => {
					const last = values.pop();
					if (last) values.unshift(last);
				}),
			);
	};
	const remove = () => {
		if (kind === "style") setProject("timeline", "styleSegments", []);
		else setProject("timeline", "imageSegments", []);
	};
	return {
		project,
		setProject,
		editorState,
		setEditorState,
		items,
		change,
		reorder,
		remove,
		scale,
		setScale,
		totalDuration: total,
		setTotal,
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
		projectActions: {
			splitOverlaySegment: vi.fn(),
			addStyleSegment: vi.fn(),
			importImageSegment: vi.fn(async () => {}),
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
	dispose?.();
	dispose = undefined;
	document.body.innerHTML = "";
	vi.unstubAllGlobals();
});
const roots = () => [
	...document.querySelectorAll<HTMLElement>("[data-overlay-segment]"),
];
const content = (index = 0) => {
	const node = roots()[index]?.querySelector(".cursor-grab");
	if (!(node instanceof HTMLElement))
		throw new Error("Missing overlay content");
	return node;
};
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
function begin() {
	mouse(content(), "mousedown", 200);
	mouse(window, "mousemove", 300);
}
function mount(
	kind: Kind,
	snapping?: {
		enabled: () => boolean;
		targets: () => number[];
		setGuide: (time: number | null) => void;
	},
) {
	const [shown, setShown] = createSignal(true);
	const [lane, setLane] = createSignal(0);
	const onDragStateChanged = vi.fn();
	dispose = render(() => {
		context = fixture(kind);
		return (
			<TimelineContextProvider
				duration={context.totalDuration()}
				secsPerPixel={context.scale()}
				snapping={snapping}
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
					{kind === "style" ? (
						<StyleTrack
							laneIndex={lane()}
							onDragStateChanged={onDragStateChanged}
							handleUpdatePlayhead={() => {}}
						/>
					) : (
						<ImageTrack
							laneIndex={lane()}
							onDragStateChanged={onDragStateChanged}
							handleUpdatePlayhead={() => {}}
						/>
					)}
				</Show>
			</TimelineContextProvider>
		);
	}, document.body);
	return { setShown, setLane, onDragStateChanged };
}
for (const kind of ["style", "image"] as const)
	describe(kind, () => {
		it("snaps to a nearby edge, allows Alt to bypass it, and clears the guide", () => {
			const setGuide = vi.fn();
			mount(kind, { enabled: () => true, targets: () => [3.04], setGuide });
			const item = context.items()[1];
			begin();
			expect(item.start).toBeCloseTo(3.04);
			expect(item.end - item.start).toBeCloseTo(4);
			expect(setGuide).toHaveBeenLastCalledWith(3.04);
			window.dispatchEvent(
				new MouseEvent("mousemove", { clientX: 300, buttons: 1, altKey: true }),
			);
			expect(item.start).toBeCloseTo(3);
			expect(setGuide).toHaveBeenLastCalledWith(null);
			mouse(window, "mouseup", 300, 0);
			expect(item.start).toBeCloseTo(3.04);
			expect(setGuide).toHaveBeenLastCalledWith(null);
		});

		it("keeps the source item, DOM and selection after an external array reorder", () => {
			mount(kind);
			const node = roots()[0];
			const a = context.items()[1];
			const hidden = context.items()[0];
			begin();
			batch(() => {
				context.reorder();
				context.setEditorState("timeline", "selection", {
					type: kind,
					indices: [2],
				});
			});
			mouse(window, "mousemove", 400);
			mouse(window, "mouseup", 500, 0);
			expect(a).toMatchObject({ start: 5, end: 9 });
			expect(hidden).toMatchObject({ start: 20, end: 24 });
			expect(roots()[1]).toBe(node);
			expect(context.editorState.timeline.selection?.indices).toEqual([2]);
			expect(context.counts().resumes).toBe(1);
		});
		it.each([
			"mode",
			"range",
			"track",
			"lane",
			"buttons",
			"scale",
			"duration",
			"delete",
		] as const)("ends on %s and ignores late input", (reason) => {
			const f = mount(kind);
			begin();
			if (reason === "mode")
				context.setEditorState("timeline", "interactMode", "split");
			if (reason === "range") context.change(1, { start: 30, end: 34 });
			if (reason === "track") context.change(1, { track: 1 });
			if (reason === "lane") f.setLane(1);
			if (reason === "buttons") mouse(window, "mousemove", 300, 0);
			if (reason === "scale") context.setScale(0.02);
			if (reason === "duration") context.setTotal(30);
			if (reason === "delete") context.remove();
			const before = JSON.stringify(context.project);
			const resumed = context.counts().resumes;
			mouse(window, "mousemove", 400);
			mouse(window, "mouseup", 500, 0);
			expect(JSON.stringify(context.project)).toBe(before);
			expect(resumed).toBe(1);
			expect(context.counts().resumes).toBe(1);
			expect(f.onDragStateChanged).toHaveBeenLastCalledWith({ type: "idle" });
		});
		it.each(["blur", "escape", "unmount"] as const)(
			"restores the original range on %s without an empty undo",
			(reason) => {
				const f = mount(kind);
				begin();
				if (reason === "blur") window.dispatchEvent(new Event("blur"));
				if (reason === "escape")
					document.body.dispatchEvent(
						new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
					);
				if (reason === "unmount") f.setShown(false);
				expect(context.items()[1]).toMatchObject({ start: 2, end: 6 });
				const before = JSON.stringify(context.project);
				mouse(window, "mousemove", 400);
				mouse(window, "mouseup", 500, 0);
				expect(JSON.stringify(context.project)).toBe(before);
				expect(context.projectHistory.canUndo()).toBe(false);
				expect(context.counts().resumes).toBe(1);
			},
		);
		it("ends before undo so late input cannot overwrite it", () => {
			mount(kind);
			begin();
			document.body.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "z",
					code: "KeyZ",
					metaKey: true,
					bubbles: true,
				}),
			);
			expect(context.items()[1].start).toBe(2);
			mouse(window, "mousemove", 500);
			mouse(window, "mouseup", 500, 0);
			expect(context.items()[1].start).toBe(2);
			context.projectHistory.redo();
			expect(context.items()[1].start).toBe(3);
		});
		it("does not finish on a secondary release", () => {
			mount(kind);
			begin();
			mouse(window, "mouseup", 350, 1, 2);
			expect(context.counts().resumes).toBe(0);
			mouse(window, "mouseup", 400, 0);
			expect(context.items()[1]).toMatchObject({ start: 4, end: 8 });
			expect(context.counts().resumes).toBe(1);
		});
		it("keeps current non-time properties and does not create an empty click history", () => {
			mount(kind);
			mouse(content(), "mousedown", 200);
			mouse(window, "mouseup", 200, 0);
			expect(context.projectHistory.pause).not.toHaveBeenCalled();
			begin();
			context.change(1, { name: "Updated" });
			mouse(window, "mouseup", 500, 0);
			expect(context.items()[1]).toMatchObject({
				start: 5,
				end: 9,
				name: "Updated",
			});
		});
		it.each(["start", "end"] as const)(
			"trims %s using full down-to-release movement",
			(edge) => {
				mount(kind);
				const handle =
					roots()[0].querySelectorAll("[data-compact]")[
						edge === "start" ? 0 : 1
					];
				mouse(handle, "mousedown", 200);
				mouse(window, "mouseup", 300, 0);
				expect(context.items()[1][edge]).toBe(edge === "start" ? 3 : 7);
				expect(context.items()[0]).toMatchObject({ start: 20, end: 24 });
			},
		);
		it("does not overwrite an external neighbour edit when ending", () => {
			mount(kind);
			begin();
			context.change(2, { start: 8, end: 12 });
			expect(context.items()[1]).toMatchObject({ start: 3, end: 7 });
			mouse(window, "mousemove", 600);
			mouse(window, "mouseup", 600, 0);
			expect(context.items()[1]).toMatchObject({ start: 3, end: 7 });
			expect(context.items()[2]).toMatchObject({ start: 8, end: 12 });
			expect(context.counts().resumes).toBe(1);
		});
		it("reverts only the range on Escape while keeping current visual edits in history", () => {
			mount(kind);
			begin();
			context.change(1, { name: "Updated" });
			document.body.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
			expect(context.items()[1]).toMatchObject({
				start: 2,
				end: 6,
				name: "Updated",
			});
			context.projectHistory.undo();
			expect(context.items()[1].name).not.toBe("Updated");
			context.projectHistory.redo();
			expect(context.items()[1].name).toBe("Updated");
		});
		it("splits the current source index after reordering, including filtered lanes", () => {
			mount(kind);
			context.reorder();
			context.setEditorState("timeline", "interactMode", "split");
			mouse(content(), "mousedown", 200);
			expect(context.projectActions.splitOverlaySegment).toHaveBeenCalledWith(
				kind,
				0,
				2,
			);
			expect(context.projectHistory.pause).not.toHaveBeenCalled();
		});
	});
