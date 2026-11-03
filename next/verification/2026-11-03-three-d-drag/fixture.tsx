import { batch, createSignal, Show } from "solid-js";
import { produce, unwrap } from "solid-js/store";
import { render } from "solid-js/web";
import { TimelineContextProvider } from "../../cap/apps/desktop/src/routes/editor/Timeline/context";
import { ThreeDTrack } from "../../cap/apps/desktop/src/routes/editor/Timeline/ThreeDTrack";
import {
	type Camera3DSegment,
	fitCamera3DMotionToSegment,
	newCamera3DShot,
} from "../../cap/apps/desktop/src/routes/editor/three-d";
import { reset } from "./context-mock";

let dispose: (() => void) | undefined;
const roots = () => [
	...document.querySelectorAll<HTMLElement>('[title^="3D 镜头"]'),
];
function mount(empty = false) {
	dispose?.();
	const [shown, setShown] = createSignal(true);
	const states: string[] = [];
	let context: ReturnType<typeof reset> | undefined;
	dispose = render(() => {
		const current = reset(empty);
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
					<ThreeDTrack
						onDragStateChanged={(value) => states.push(value.type)}
						handleUpdatePlayhead={() => {}}
					/>
				</Show>
			</TimelineContextProvider>
		);
	}, document.getElementById("root") as HTMLElement);
	if (!context) throw new Error("Missing browser context");
	const node = roots()[0];
	return {
		context,
		node,
		content: node?.querySelector(".cursor-grab") as HTMLElement,
		lane: document.getElementById("root")?.firstElementChild as HTMLElement,
		setShown,
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
	mouse(window, "mousemove", 250);
	mouse(window, "mousemove", 300);
}
function signature(segment: Camera3DSegment) {
	return JSON.stringify({
		properties: segment.properties,
		blur: segment.blur,
		tracks: Object.fromEntries(
			Object.entries(segment.tracks).map(([key, frames]) => [
				key,
				frames.map((frame) => ({
					...frame,
					time:
						Math.round((frame.time / (segment.end - segment.start)) * 1e10) /
						1e10,
				})),
			]),
		),
	});
}

function checks() {
	const observations: { name: string; passed: boolean }[] = [];
	const check = (name: string, passed: boolean) => {
		observations.push({ name, passed });
		if (!passed) throw new Error(name);
	};
	for (const reason of [
		"blur",
		"escape",
		"unmount",
		"mode",
		"replace",
		"range",
		"buttons",
		"scale",
		"duration",
		"delete",
	]) {
		const f = mount();
		begin(f.content);
		if (reason === "blur") window.dispatchEvent(new Event("blur"));
		if (reason === "escape")
			document.body.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
		if (reason === "unmount") f.setShown(false);
		if (reason === "mode")
			f.context.setEditorState("timeline", "interactMode", "split");
		if (reason === "replace")
			f.context.setProject(
				"timeline",
				"camera3dSegments",
				0,
				newCamera3DShot(30, 34),
			);
		if (reason === "range")
			f.context.setProject("timeline", "camera3dSegments", 0, {
				start: 30,
				end: 34,
			});
		if (reason === "buttons") mouse(window, "mousemove", 300, 0);
		if (reason === "scale") f.context.setScale(0.02);
		if (reason === "duration") f.context.setTotal(50);
		if (reason === "delete")
			f.context.setProject("timeline", "camera3dSegments", []);
		const before = JSON.stringify(f.context.project);
		check(
			`${reason}/finish`,
			f.context.counts().resumes === 1 && f.states.at(-1) === "idle",
		);
		mouse(window, "mousemove", 400);
		mouse(window, "mouseup", 500, 0);
		check(
			`${reason}/late-events`,
			JSON.stringify(f.context.project) === before &&
				f.context.counts().resumes === 1,
		);
	}
	for (const reason of [
		"blur",
		"escape",
		"unmount",
		"mode",
		"buttons",
		"scale",
		"duration",
	]) {
		const f = mount(true);
		f.context.setEditorState("timeline", "hoveredTrack", "3d");
		f.context.setEditorState("previewTime", 4);
		begin(f.lane);
		if (reason === "blur") window.dispatchEvent(new Event("blur"));
		if (reason === "escape")
			document.body.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
		if (reason === "unmount") f.setShown(false);
		if (reason === "mode")
			f.context.setEditorState("timeline", "interactMode", "split");
		if (reason === "buttons") mouse(window, "mousemove", 300, 0);
		if (reason === "scale") f.context.setScale(0.02);
		if (reason === "duration") f.context.setTotal(50);
		mouse(window, "mousemove", 400);
		mouse(window, "mouseup", 500, 0);
		check(
			`creation/${reason}`,
			f.context.counts().ranges.length === 0 &&
				!document.querySelector(".cap-add-shot-ghost"),
		);
	}
	{
		const f = mount();
		const a = f.context.project.timeline.camera3dSegments[0];
		const b = f.context.project.timeline.camera3dSegments[1];
		f.context.setEditorState("timeline", "selection", {
			type: "3d",
			indices: [0],
		});
		begin(f.content);
		batch(() => {
			f.context.setProject(
				"timeline",
				"camera3dSegments",
				produce((items) => {
					items[1].start = 0;
					items[1].end = 1;
					fitCamera3DMotionToSegment(items[1]);
					items.sort((left, right) => left.start - right.start);
				}),
			);
			f.context.setEditorState("timeline", "selection", {
				type: "3d",
				indices: [1],
			});
		});
		mouse(window, "mousemove", 400);
		mouse(window, "mouseup", 500, 0);
		check("reorder/data", a.start === 5 && b.start === 0 && b.end === 1);
		check("reorder/dom", roots()[1] === f.node);
		check(
			"reorder/selection",
			f.context.editorState.timeline.selection?.indices[0] === 1,
		);
	}
	for (const edge of ["start", "end"] as const) {
		const f = mount();
		const a = f.context.project.timeline.camera3dSegments[0];
		const before = signature(structuredClone(unwrap(a)));
		const handle =
			f.node.querySelectorAll("[data-compact]")[edge === "start" ? 0 : 1];
		mouse(handle, "mousedown", 200);
		mouse(window, "mousemove", 300);
		mouse(window, "mouseup", 300, 0);
		check(`trim/${edge}/position`, a[edge] === (edge === "start" ? 3 : 7));
		check(`trim/${edge}/motion`, signature(a) === before);
	}
	{
		const f = mount();
		mouse(f.content, "mousedown", 200);
		mouse(window, "mousemove", 600);
		mouse(window, "mouseup", 600, 0);
		check(
			"coalesced-move",
			f.context.project.timeline.camera3dSegments[0].start === 6,
		);
	}
	{
		const f = mount();
		begin(f.content);
		document.body.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "z",
				code: "KeyZ",
				metaKey: true,
				bubbles: true,
			}),
		);
		check(
			"history/undo",
			f.context.project.timeline.camera3dSegments[0].start === 2,
		);
		mouse(window, "mousemove", 400);
		mouse(window, "mouseup", 500, 0);
		check(
			"history/no-overwrite",
			f.context.project.timeline.camera3dSegments[0].start === 2,
		);
		f.context.projectHistory.redo();
		check(
			"history/redo",
			f.context.project.timeline.camera3dSegments[0].start === 3,
		);
	}
	return { observations, passed: observations.every((value) => value.passed) };
}
Object.assign(window, { threeDProbe: { mount, checks, signature } });
