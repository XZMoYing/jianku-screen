import { batch, createSignal, Show } from "solid-js";
import { render } from "solid-js/web";
import { TimelineContextProvider } from "../../cap/apps/desktop/src/routes/editor/Timeline/context";
import { ImageTrack } from "../../cap/apps/desktop/src/routes/editor/Timeline/image-track";
import { StyleTrack } from "../../cap/apps/desktop/src/routes/editor/Timeline/style-track";
import type {
	ImageSegment,
	StyleSegment,
} from "../../cap/apps/desktop/src/utils/tauri";
import { reset } from "./context-mock";

let dispose: (() => void) | undefined;
const roots = () => [
	...document.querySelectorAll<HTMLElement>("[data-overlay-segment]"),
];
function mount(kind: "style" | "image") {
	dispose?.();
	const [shown, setShown] = createSignal(true);
	const [lane, setLane] = createSignal(0);
	const states: string[] = [];
	let context: ReturnType<typeof reset> | undefined;
	dispose = render(() => {
		const current = reset(kind);
		context = current;
		return (
			<TimelineContextProvider
				duration={current.totalDuration()}
				secsPerPixel={current.scale()}
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
							onDragStateChanged={(value) => states.push(value.type)}
							handleUpdatePlayhead={() => {}}
						/>
					) : (
						<ImageTrack
							laneIndex={lane()}
							onDragStateChanged={(value) => states.push(value.type)}
							handleUpdatePlayhead={() => {}}
						/>
					)}
				</Show>
			</TimelineContextProvider>
		);
	}, document.getElementById("root") as HTMLElement);
	if (!context) throw new Error("Missing overlay fixture");
	const node = roots()[0];
	return {
		context,
		node,
		content: node.querySelector(".cursor-grab") as HTMLElement,
		setShown,
		setLane,
		states,
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
function begin(node: HTMLElement) {
	mouse(node, "mousedown", 200);
	mouse(window, "mousemove", 300);
}
function signature(item: StyleSegment | ImageSegment) {
	return JSON.stringify(
		Object.fromEntries(
			Object.entries(item).filter(([key]) => key !== "start" && key !== "end"),
		),
	);
}
function checks() {
	const observations: { name: string; passed: boolean }[] = [];
	const check = (name: string, passed: boolean) => {
		observations.push({ name, passed });
		if (!passed) throw new Error(name);
	};
	for (const kind of ["style", "image"] as const) {
		for (const reason of [
			"mode",
			"range",
			"track",
			"lane",
			"buttons",
			"scale",
			"duration",
			"delete",
		]) {
			const f = mount(kind);
			begin(f.content);
			if (reason === "mode")
				f.context.setEditorState("timeline", "interactMode", "split");
			if (reason === "range") f.context.change(1, { start: 30, end: 34 });
			if (reason === "track") f.context.change(1, { track: 1 });
			if (reason === "lane") f.setLane(1);
			if (reason === "buttons") mouse(window, "mousemove", 300, 0);
			if (reason === "scale") f.context.setScale(0.02);
			if (reason === "duration") f.context.setTotal(30);
			if (reason === "delete") f.context.remove();
			const before = JSON.stringify(f.context.project);
			check(
				`${kind}/${reason}/finish`,
				f.context.counts().resumes === 1 && f.states.at(-1) === "idle",
			);
			mouse(window, "mousemove", 400);
			mouse(window, "mouseup", 500, 0);
			check(
				`${kind}/${reason}/late-events`,
				JSON.stringify(f.context.project) === before &&
					f.context.counts().resumes === 1,
			);
		}
		for (const reason of ["blur", "escape", "unmount"]) {
			const f = mount(kind);
			begin(f.content);
			if (reason === "blur") window.dispatchEvent(new Event("blur"));
			if (reason === "escape")
				document.body.dispatchEvent(
					new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
				);
			if (reason === "unmount") f.setShown(false);
			check(
				`${kind}/${reason}/rollback`,
				f.context.items()[1].start === 2 &&
					f.context.items()[1].end === 6 &&
					!f.context.projectHistory.canUndo(),
			);
			mouse(window, "mousemove", 400);
			mouse(window, "mouseup", 500, 0);
			check(
				`${kind}/${reason}/late-events`,
				f.context.items()[1].start === 2 && f.context.counts().resumes === 1,
			);
		}
		{
			const f = mount(kind);
			const a = f.context.items()[1];
			const hidden = f.context.items()[0];
			begin(f.content);
			batch(() => {
				f.context.reorder();
				f.context.setEditorState("timeline", "selection", {
					type: kind,
					indices: [2],
				});
			});
			mouse(window, "mousemove", 400);
			mouse(window, "mouseup", 500, 0);
			check(
				`${kind}/reorder/data`,
				a.start === 5 &&
					a.end === 9 &&
					hidden.start === 20 &&
					hidden.end === 24,
			);
			check(`${kind}/reorder/dom`, roots()[1] === f.node);
			check(
				`${kind}/reorder/selection`,
				f.context.editorState.timeline.selection?.indices[0] === 2,
			);
		}
		for (const edge of ["start", "end"] as const) {
			const f = mount(kind);
			const a = f.context.items()[1];
			const before = signature(a);
			const handle =
				f.node.querySelectorAll("[data-compact]")[edge === "start" ? 0 : 1];
			mouse(handle, "mousedown", 200);
			mouse(window, "mouseup", 300, 0);
			check(
				`${kind}/trim/${edge}`,
				a[edge] === (edge === "start" ? 3 : 7) && signature(a) === before,
			);
		}
		{
			const f = mount(kind);
			begin(f.content);
			mouse(window, "mouseup", 350, 1, 2);
			check(`${kind}/secondary-release`, f.context.counts().resumes === 0);
			mouse(window, "mouseup", 400, 0);
			check(
				`${kind}/primary-release`,
				f.context.items()[1].start === 4 &&
					f.context.items()[1].end === 8 &&
					f.context.counts().resumes === 1,
			);
		}
		{
			const f = mount(kind);
			begin(f.content);
			document.body.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "z",
					code: "KeyZ",
					metaKey: true,
					bubbles: true,
				}),
			);
			check(`${kind}/history/undo`, f.context.items()[1].start === 2);
			mouse(window, "mousemove", 400);
			mouse(window, "mouseup", 500, 0);
			check(`${kind}/history/late-events`, f.context.items()[1].start === 2);
			f.context.projectHistory.redo();
			check(`${kind}/history/redo`, f.context.items()[1].start === 3);
		}
		{
			const f = mount(kind);
			mouse(f.content, "mousedown", 200);
			mouse(window, "mouseup", 200, 0);
			check(`${kind}/history/no-op`, !f.context.projectHistory.canUndo());
			begin(f.content);
			f.context.change(1, { name: "Updated" });
			document.body.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
			check(
				`${kind}/history/cancel-metadata`,
				f.context.items()[1].start === 2 &&
					f.context.items()[1].name === "Updated",
			);
			f.context.projectHistory.undo();
			check(
				`${kind}/history/metadata-undo`,
				f.context.items()[1].name !== "Updated",
			);
		}
	}
	return { observations, passed: observations.every((value) => value.passed) };
}
Object.assign(window, { overlayProbe: { mount, checks, signature } });
