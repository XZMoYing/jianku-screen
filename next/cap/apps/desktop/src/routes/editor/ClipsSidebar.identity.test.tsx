import { batch } from "solid-js";
import { createStore } from "solid-js/store";
import { render } from "solid-js/web";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ClipInspector } from "./ClipInspector";
import { ClipsSidebar } from "./ClipsSidebar";

const state = vi.hoisted(() => ({ context: {} as object }));
vi.mock("./context", () => ({ useEditorContext: () => state.context }));
vi.mock("~/utils/i18n", () => ({ t: (text: string) => text }));
vi.mock("~/utils/tauri", () => ({ commands: {} }));
vi.mock("@cap/ui-solid", () => ({
	Button: (props: { children: unknown; onClick?: () => void }) => (
		<button onClick={props.onClick}>{props.children as string}</button>
	),
}));

let dispose: (() => void) | undefined;
const clips = () => [
	{ id: "a", start: 0, end: 5, timescale: 1, recordingSegment: 0 },
	{ id: "b", start: 5, end: 10, timescale: 1, recordingSegment: 0 },
	{ id: "c", start: 10, end: 15, timescale: 1, recordingSegment: 0 },
];
beforeEach(() => {
	for (const name of [
		"IconCapCirclePlus",
		"IconCapClapperboard",
		"IconCapMoveLeft",
		"IconCapPencil",
		"IconCapTrash",
		"IconLucideVideo",
	])
		vi.stubGlobal(name, () => null);
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			disconnect() {}
		},
	);
	vi.stubGlobal(
		"IntersectionObserver",
		class {
			observe() {}
			disconnect() {}
		},
	);
});
afterEach(() => {
	dispose?.();
	dispose = undefined;
	document.body.innerHTML = "";
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
function mount() {
	const [project, setProject] = createStore({
		timeline: { segments: clips() },
	});
	const moveClipSegment = vi.fn();
	const addTrackContent = vi.fn();
	const openCaptionInspector = vi.fn();
	const [editorState, setEditorState] = createStore({
		materialsTab: "video",
		timeline: { audioPicker: null },
	});
	state.context = {
		project,
		projectActions: { moveClipSegment },
		editorInstance: {
			path: "test",
			recordings: { segments: [{ display: { duration: 15 } }] },
		},
		editorState,
		setEditorState,
		timelineCommands: { addTrackContent, openCaptionInspector },
		keymap: { matches: () => false, label: () => undefined },
	};
	dispose = render(() => <ClipsSidebar />, document.body);
	const clipsTab = [
		...document.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
	].find((tab) => tab.textContent?.includes("时间线片段"));
	if (!clipsTab) throw new Error("Missing timeline clips tab");
	clipsTab.click();
	const cards = () => [
		...document.querySelectorAll<HTMLElement>("[data-clip-card]"),
	];
	const list = cards()[0]?.parentElement?.parentElement?.parentElement;
	if (!list) throw new Error("Missing list");
	vi.spyOn(list, "getBoundingClientRect").mockReturnValue({
		left: 0,
		right: 200,
		top: 0,
		bottom: 400,
	} as DOMRect);
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
		function (this: HTMLElement) {
			const index = cards().indexOf(this);
			return {
				left: 0,
				right: 200,
				top: index * 100,
				bottom: index * 100 + 100,
				height: 100,
			} as DOMRect;
		},
	);
	return {
		setProject,
		moveClipSegment,
		cards,
		editorState,
		addTrackContent,
		openCaptionInspector,
	};
}
function mouse(target: EventTarget, type: string, y: number, x = 50) {
	target.dispatchEvent(
		new MouseEvent(type, {
			bubbles: true,
			button: 0,
			buttons: type === "mouseup" ? 0 : 1,
			clientX: x,
			clientY: y,
		}),
	);
}
function begin(cards: HTMLElement[]) {
	mouse(cards[1], "mousedown", 150);
	mouse(window, "mousemove", 170);
}

it("opens tools by material category and keeps the video list tab on return", () => {
	vi.stubGlobal("matchMedia", () => ({
		matches: true,
		addEventListener: () => {},
		removeEventListener: () => {},
	}));
	const fixture = mount();
	const button = (role: string, text: string) =>
		[...document.querySelectorAll<HTMLButtonElement>(role)].find(
			(item) => item.textContent?.trim() === text,
		);
	button('[role="tab"]', "文字")?.click();
	expect(fixture.editorState.materialsTab).toBe("text");
	button("button", "添加文字")?.click();
	button("button", "智能字幕")?.click();
	expect(fixture.addTrackContent).toHaveBeenCalledWith("text");
	expect(fixture.openCaptionInspector).toHaveBeenCalledOnce();
	button('[role="tab"]', "标注")?.click();
	expect(fixture.editorState.materialsTab).toBe("graphics");
	button('[role="tab"]', "视频")?.click();
	expect(fixture.cards()).toHaveLength(3);
});

it("shows source geometry and dispatches speed only for the selected clip", () => {
	vi.stubGlobal("matchMedia", () => ({
		matches: true,
		addEventListener: () => {},
		removeEventListener: () => {},
	}));
	const [project] = createStore({ timeline: { segments: clips() } });
	const setClipSegmentTimescale = vi.fn();
	state.context = {
		project,
		projectActions: { setClipSegmentTimescale },
		setEditorState: vi.fn(),
	};
	dispose = render(() => <ClipInspector indices={[1]} />, document.body);
	expect(document.querySelector('[role="tabpanel"]')?.textContent).toContain(
		"素材入点",
	);
	const speed = [
		...document.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
	].find((tab) => tab.textContent === "变速");
	expect(speed).toBeDefined();
	speed?.click();
	const twice = [
		...document.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
	].find((option) => option.textContent === "2x");
	expect(twice).toBeDefined();
	twice?.click();
	expect(setClipSegmentTimescale).toHaveBeenCalledWith(1, 2);
});
it("keeps the dragged identity across list changes and uses the release position", () => {
	const { cards, setProject, moveClipSegment } = mount();
	begin(cards());
	batch(() =>
		setProject("timeline", "segments", [clips()[2], clips()[0], clips()[1]]),
	);
	mouse(window, "mouseup", 10);
	expect(moveClipSegment).toHaveBeenCalledOnce();
	expect(moveClipSegment).toHaveBeenCalledWith("b", 0);
});
it.each(["escape", "blur", "deleted", "outside"])("cancels on %s", (reason) => {
	const { cards, setProject, moveClipSegment } = mount();
	begin(cards());
	if (reason === "escape")
		window.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
	if (reason === "blur") window.dispatchEvent(new Event("blur"));
	if (reason === "deleted")
		setProject("timeline", "segments", [clips()[0], clips()[2]]);
	mouse(window, "mouseup", 250, reason === "outside" ? 250 : 50);
	expect(moveClipSegment).not.toHaveBeenCalled();
});
