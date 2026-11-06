import { batch, createSignal, Show } from "solid-js";
import { createStore, produce, unwrap } from "solid-js/store";
import { render } from "solid-js/web";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { commands, type ZoomSegment } from "~/utils/tauri";
import { createStoreHistory } from "../project-history";
import { TimelineContextProvider } from "./context";
import { createTimelineSegmentMenu } from "./segment-menu";
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
	commands: {
		generateZoomSegmentsFromClicks: vi.fn(async () => []),
		projectZoomTrack: vi.fn(async () => []),
	},
}));
vi.mock("@tauri-apps/api/menu", () => ({
	Menu: { new: vi.fn(async () => ({ popup: vi.fn() })) },
}));

const { showMenu } = vi.hoisted(() => ({
	showMenu:
		vi.fn<
			(
				event: MouseEvent | KeyboardEvent,
				title: string,
				entries: { label: string; danger?: boolean; run: () => void }[],
			) => void
		>(),
}));
vi.mock("../editor-context-menu", async (importOriginal) => ({
	...(await importOriginal<typeof import("../editor-context-menu")>()),
	createEditorContextMenu: () => ({ show: showMenu }),
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
function fixture(segments: ZoomSegment[], associations = false) {
	const [project, setProject] = createStore({
		timeline: {
			segments: [
				{ id: "a", name: "Source A", start: 0, end: 4, timescale: 1 },
				{ id: "b", name: "Source B", start: 4, end: 8, timescale: 1 },
			],
			zoomSegments: segments,
		},
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
	const deleteZoomSegments = vi.fn();
	return {
		keymap: { label: () => "Delete" },
		timelineCommands: {
			trackSegments: () => project.timeline.zoomSegments,
			overlayAssociation: (_type: string, index: number) => {
				if (!associations) return null;
				const attachment = project.timeline.zoomSegments[index]?.attachment;
				return {
					attachment,
					status:
						attachment?.kind === "clip"
							? "attached"
							: attachment
								? "timeline"
								: "unassigned",
					label:
						attachment?.kind === "clip"
							? "Follows test clip"
							: attachment
								? "Fixed timeline position"
								: "No clip association",
					canFollowSpeed: true,
				};
			},
			overlayAssociationTarget: () => ({ id: "video-a", name: "test clip" }),
			setOverlayAttachment: vi.fn(
				(_type: string, index: number, clipId: string | null) => {
					setProject(
						"timeline",
						"zoomSegments",
						index,
						"attachment",
						clipId
							? { kind: "clip", id: "overlay-a", clipId, sourceTime: 2 }
							: { kind: "timeline", id: "overlay-a" },
					);
				},
			),
			selectSegments: (type: "zoom", indices: number[]) =>
				setEditorState("timeline", "selection", { type, indices }),
			deleteSelection: () =>
				deleteZoomSegments(editorState.timeline.selection?.indices),
		},
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
		projectActions: { splitZoomSegment: vi.fn(), deleteZoomSegments },
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
function mount(segments = [segment(2), segment(10)], associations = false) {
	const [shown, setShown] = createSignal(true);
	const onDragStateChanged = vi.fn();
	const moveTo = vi.fn();
	dispose = render(() => {
		context = fixture(segments, associations);
		const menu = createTimelineSegmentMenu(moveTo);
		return (
			<TimelineContextProvider
				duration={context.totalDuration()}
				secsPerPixel={context.scale()}
				showSegmentMenu={(event, target) => menu.show(event, target, "Zoom")}
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
	return { setShown, lane, onDragStateChanged, moveTo };
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

it("exposes linking, unlinking and the source state on the timeline segment", () => {
	const bounds = vi
		.spyOn(HTMLElement.prototype, "getBoundingClientRect")
		.mockReturnValue(new DOMRect(0, 0, 1000, 44));
	try {
		mount([segment(2)], true);
		mouse(roots()[0], "contextmenu", 200, 0, 2);
		const link = showMenu.mock.lastCall?.[2].find(
			(entry) => entry.label === "Associate with {name}",
		);
		expect(link).toBeDefined();
		link?.run();
		expect(context.timelineCommands.setOverlayAttachment).toHaveBeenCalledWith(
			"zoom",
			0,
			"video-a",
		);
		expect(
			roots()[0]
				.querySelector('[data-overlay-association="attached"]')
				?.getAttribute("aria-label"),
		).toBe("Follows test clip");
		mouse(roots()[0], "contextmenu", 200, 0, 2);
		const unlink = showMenu.mock.lastCall?.[2].find(
			(entry) => entry.label === "Unlink and keep current position",
		);
		expect(unlink).toBeDefined();
		unlink?.run();
		expect(
			context.timelineCommands.setOverlayAttachment,
		).toHaveBeenLastCalledWith("zoom", 0, null);
		expect(
			roots()[0].querySelector('[data-overlay-association="timeline"]'),
		).not.toBeNull();
	} finally {
		bounds.mockRestore();
	}
});

it.each(["menu", "blade"] as const)(
	"draws effective slices and splits at their actual time with the %s",
	async (action) => {
		const sourceSlices: ZoomSegment["sourceSlices"] = [
			{
				phaseStart: 0,
				phaseEnd: 1,
				sourceEnd: 4,
				attachment: { kind: "clip", id: "left", clipId: "a", sourceTime: 3 },
			},
			{
				phaseStart: 1,
				phaseEnd: 2,
				sourceEnd: 5,
				attachment: { kind: "clip", id: "right", clipId: "b", sourceTime: 4 },
			},
		];
		vi.mocked(commands.projectZoomTrack).mockResolvedValueOnce([
			{
				groupIndex: 1,
				hasConflict: true,
				hasMissingSource: false,
				spans: [
					{
						start: 6,
						end: 6.25,
						segmentIndex: 1,
						availableStart: 6,
						availableEnd: 6.25,
						moveStart: 6,
						moveEnd: 7,
						sourceRate: 1,
						sliceIndex: 1,
						phaseStart: 1,
						phaseEnd: 1.25,
					},
					{
						start: 6.5,
						end: 6.75,
						segmentIndex: 1,
						availableStart: 6.5,
						availableEnd: 6.75,
						moveStart: 6,
						moveEnd: 7,
						sourceRate: 1,
						sliceIndex: 1,
						phaseStart: 1.5,
						phaseEnd: 1.75,
					},
				],
			},
			{ groupIndex: 2, hasConflict: false, hasMissingSource: true, spans: [] },
		]);
		const mounted = mount(
			[
				segment(10),
				{ ...segment(3, 5), sourceSlices },
				{ ...segment(7, 9), sourceSlices },
			],
			true,
		);
		const slices = () => [
			...document.querySelectorAll<HTMLElement>(
				'[data-zoom-projection="slice"]',
			),
		];
		await vi.waitFor(() => expect(slices()).toHaveLength(2));
		expect(roots()).toHaveLength(1);
		const position = (node: HTMLElement) =>
			Number.parseFloat(node.style.getPropertyValue("--segment-x"));
		expect(position(slices()[0])).toBeCloseTo(position(roots()[0]) * 0.6);
		expect(position(slices()[1])).toBeCloseTo(position(roots()[0]) * 0.65);
		expect(slices()[1].title).toContain("Some zoom slices are covered");
		expect(
			document
				.querySelector('[data-zoom-projection="inactive"]')
				?.getAttribute("title"),
		).toContain("Some zoom sources are missing");

		mouse(slices()[1], "mousedown", 660);
		expect(context.editorState.timeline.selection).toEqual({
			type: "zoom",
			indices: [1],
		});
		mouse(slices()[1], "contextmenu", 660, 0, 2);
		const menu = showMenu.mock.lastCall?.[2];
		menu?.find((entry) => entry.label === "Go to zoom slice start")?.run();
		expect(mounted.moveTo).toHaveBeenCalledWith(6.5);
		expect(context.project.timeline.zoomSegments[1]).toMatchObject({
			start: 3,
			end: 5,
			sourceSlices,
		});
		expect(context.projectHistory.canUndo()).toBe(false);
		if (action === "menu") {
			context.setEditorState("playbackTime", 6.625);
			mouse(slices()[1], "contextmenu", 660, 0, 2);
			showMenu.mock.lastCall?.[2]
				.find((entry) => entry.label === "Split zoom slice at playhead")
				?.run();
		} else {
			context.setEditorState("timeline", "interactMode", "split");
			vi.spyOn(slices()[1], "getBoundingClientRect").mockReturnValue(
				new DOMRect(650, 0, 50, 32),
			);
			mouse(slices()[1], "mousedown", 675);
		}
		expect(context.project.timeline.zoomSegments[1].sourceSlices).toMatchObject(
			[
				sourceSlices[0],
				{
					phaseStart: 1,
					phaseEnd: 1.625,
					sourceEnd: 4.625,
					attachment: { sourceTime: 4 },
				},
				{
					phaseStart: 1.625,
					phaseEnd: 2,
					sourceEnd: 5,
					attachment: { sourceTime: 4.625 },
				},
			],
		);
		context.projectHistory.undo();
		expect(context.project.timeline.zoomSegments[1]).toMatchObject({
			start: 3,
			end: 5,
			sourceSlices,
		});
		expect(context.projectHistory.canUndo()).toBe(false);
	},
);

it.each(["trim", "extend", "cancel"] as const)(
	"projected slice handles %s without rewriting the source",
	async (action) => {
		const sourceSlices: ZoomSegment["sourceSlices"] = [
			{
				phaseStart: 0,
				phaseEnd: 1,
				sourceEnd: 4,
				attachment: { kind: "clip", id: "left", clipId: "a", sourceTime: 3 },
			},
			{
				phaseStart: 1,
				phaseEnd: 2,
				sourceEnd: 5,
				attachment: { kind: "clip", id: "right", clipId: "b", sourceTime: 4 },
				...(action === "extend" ? { trim: { start: 1.25, end: 2 } } : {}),
			},
		];
		vi.mocked(commands.projectZoomTrack).mockResolvedValueOnce([
			{
				groupIndex: 0,
				hasConflict: false,
				hasMissingSource: false,
				spans: [
					{
						start: action === "extend" ? 6.125 : 6,
						end: 6.5,
						availableStart: 6,
						availableEnd: 6.5,
						moveStart: 6,
						moveEnd: 7,
						sourceRate: 2,
						segmentIndex: 1,
						sliceIndex: 1,
						phaseStart: action === "extend" ? 1.25 : 1,
						phaseEnd: 2,
					},
				],
			},
		]);
		mount([{ ...segment(3, 5), sourceSlices }]);
		const edge = action === "cancel" ? "end" : "start";
		const handle = () =>
			document.querySelector<HTMLElement>(`[data-zoom-slice-trim="${edge}"]`);
		await vi.waitFor(() => expect(handle()).not.toBeNull());
		const row = () => context.project.timeline.zoomSegments[0];
		const slice = () => row().sourceSlices?.[1];
		const targetHandle = handle();
		if (!targetHandle) throw new Error("Missing projected trim handle");
		mouse(targetHandle, "mousedown", 200);
		const target = action === "trim" ? 210 : 180;
		mouse(window, "mousemove", target);
		if (action === "trim") expect(slice()?.trim?.start).toBeCloseTo(1.2);
		if (action === "extend") expect(slice()?.trim).toBeUndefined();
		if (action === "cancel") {
			expect(slice()?.trim?.end).toBeCloseTo(1.6);
			document.body.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
			expect(slice()?.trim).toBeUndefined();
			expect(context.projectHistory.canUndo()).toBe(false);
		} else {
			mouse(window, "mouseup", target, 0);
			expect(context.projectHistory.canUndo()).toBe(true);
			context.projectHistory.undo();
			expect(row().sourceSlices).toEqual(sourceSlices);
			expect(context.projectHistory.canUndo()).toBe(false);
		}
		expect(row()).toMatchObject({ start: 3, end: 5 });
		expect(slice()).toMatchObject({
			phaseStart: 1,
			phaseEnd: 2,
			sourceEnd: 5,
			attachment: { sourceTime: 4 },
		});
	},
);

it.each(["commit", "cancel"] as const)(
	"moves just the visible projected fragment and can %s",
	async (action) => {
		const sourceSlices: ZoomSegment["sourceSlices"] = [
			{
				phaseStart: 0,
				phaseEnd: 1,
				sourceEnd: 4,
				attachment: { kind: "clip", id: "left", clipId: "a", sourceTime: 3 },
			},
			{
				phaseStart: 1,
				phaseEnd: 2,
				sourceEnd: 5,
				attachment: { kind: "clip", id: "right", clipId: "b", sourceTime: 4 },
			},
		];
		const span = {
			start: 6,
			end: 6.125,
			availableStart: 6,
			availableEnd: 6.125,
			moveStart: 6,
			moveEnd: 7,
			sourceRate: 2,
			segmentIndex: 1,
			sliceIndex: 1,
			phaseStart: 1,
			phaseEnd: 1.25,
		};
		vi.mocked(commands.projectZoomTrack).mockResolvedValueOnce([
			{
				groupIndex: 0,
				hasConflict: true,
				hasMissingSource: false,
				spans: [
					span,
					{
						...span,
						start: 6.25,
						end: 6.375,
						availableStart: 6.25,
						availableEnd: 6.375,
						phaseStart: 1.5,
						phaseEnd: 1.75,
					},
				],
			},
		]);
		mount([{ ...segment(3, 5), sourceSlices }]);
		const displayed = () => [
			...document.querySelectorAll<HTMLElement>(
				'[data-zoom-projection="slice"]',
			),
		];
		await vi.waitFor(() => expect(displayed()).toHaveLength(2));
		mouse(displayed()[1], "mousedown", 200);
		mouse(window, "mousemove", 210);
		const group = () => context.project.timeline.zoomSegments[0];
		const slices = () => group().sourceSlices ?? [];
		expect(slices()).toMatchObject([
			sourceSlices[0],
			{ phaseStart: 1, phaseEnd: 1.5, sourceEnd: 4.5 },
			{
				phaseStart: 1.5,
				phaseEnd: 1.75,
				sourceEnd: 4.75,
				attachment: { sourceTime: 4.5 },
			},
			{ phaseStart: 1.75, phaseEnd: 2, sourceEnd: 5 },
		]);
		expect(slices()[2].sourceOffset).toBeCloseTo(0.2);
		expect(slices()[1].sourceOffset).toBeUndefined();
		expect(slices()[3].sourceOffset).toBeUndefined();
		if (action === "cancel") {
			document.body.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
		} else {
			mouse(window, "mouseup", 210, 0);
			expect(context.projectHistory.canUndo()).toBe(true);
			context.projectHistory.undo();
		}
		expect(group()).toMatchObject({ start: 3, end: 5, sourceSlices });
		expect(context.projectHistory.canUndo()).toBe(false);
	},
);

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
it("restores generated sources on cancel and undo after a manual zoom move", () => {
	const sourceSlices: ZoomSegment["sourceSlices"] = [
		{
			phaseStart: 0,
			phaseEnd: 2,
			sourceEnd: 4,
			attachment: { kind: "clip", id: "left", clipId: "a", sourceTime: 2 },
		},
		{
			phaseStart: 2,
			phaseEnd: 4,
			sourceEnd: 2,
			attachment: { kind: "clip", id: "right", clipId: "b", sourceTime: 0 },
		},
	];
	mount([{ ...segment(2), sourceSlices }]);
	const zoom = () => context.project.timeline.zoomSegments[0];
	begin(content());
	expect(zoom().sourceSlices).toBeUndefined();
	document.body.dispatchEvent(
		new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
	);
	expect(zoom()).toMatchObject({ start: 2, sourceSlices });
	expect(context.projectHistory.canUndo()).toBe(false);

	begin(content());
	mouse(window, "mouseup", 300, 0);
	expect(zoom()).toMatchObject({ start: 3, end: 7 });
	expect(zoom().sourceSlices).toBeUndefined();
	context.projectHistory.undo();
	expect(zoom()).toMatchObject({ start: 2, end: 6, sourceSlices });
});

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
	const item = showMenu.mock.calls.at(-1)?.[2].find((entry) => entry.danger);
	if (!item) throw new Error("Missing deletion action");
	context.setProject(
		"timeline",
		"zoomSegments",
		produce((items) => {
			items[1].start = 0;
			items[1].end = 1;
			items.sort((left, right) => left.start - right.start);
		}),
	);
	item.run();
	expect(context.projectActions.deleteZoomSegments).toHaveBeenCalledWith([1]);
	const before = JSON.stringify(context.project);
	mouse(window, "mousemove", 600);
	mouse(window, "mouseup", 600, 0);
	expect(JSON.stringify(context.project)).toBe(before);
});

it.each([Number.NaN, Number.POSITIVE_INFINITY, 0])(
	"retains a zoom drag through unusable layout scale %s",
	(invalid) => {
		mount();
		const node = roots()[0];
		begin(content());
		context.setScale(invalid);
		expect(context.counts().resumes).toBe(0);
		context.setScale(0.01);
		mouse(window, "mousemove", 400);
		mouse(window, "mouseup", 500, 0);
		expect(context.project.timeline.zoomSegments[0]).toMatchObject({
			start: 5,
			end: 9,
			amount: 2,
		});
		expect(roots()[0]).toBe(node);
		expect(context.counts().resumes).toBe(1);
	},
);
