import { createSignal, Show } from "solid-js";
import { produce } from "solid-js/store";
import { render } from "solid-js/web";
import { TextOverlay } from "../../cap/apps/desktop/src/routes/editor/TextOverlay";
import { defaultTextSegment } from "../../cap/apps/desktop/src/routes/editor/text";
import { reset } from "./context-mock";

let dispose: (() => void) | undefined;
function mount() {
	dispose?.();
	let context: ReturnType<typeof reset> | undefined;
	let hide: (v: boolean) => void = () => {};
	let width: (v: number) => void = () => {};
	dispose = render(() => {
		context = reset();
		const [shown, setShown] = createSignal(true);
		hide = setShown;
		const [w, setWidth] = createSignal(1000);
		width = setWidth;
		context.setEditorState("previewTime", 3);
		return (
			<Show when={shown()}>
				<TextOverlay size={{ width: w(), height: 562.5 }} />
			</Show>
		);
	}, document.getElementById("root") as HTMLElement);
	if (!context) throw new Error("Missing context");
	return { context, hide, width };
}
const delay = (ms = 60) => new Promise<void>((r) => setTimeout(r, ms));
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
function mouse(target: EventTarget, type: string, x: number, buttons = 1) {
	target.dispatchEvent(
		new MouseEvent(type, {
			bubbles: true,
			button: 0,
			buttons,
			clientX: x,
			clientY: 280,
			shiftKey: true,
		}),
	);
}
function box() {
	const node = document.querySelector(".cursor-move");
	if (!(node instanceof HTMLElement)) throw new Error("No text box");
	return node;
}
async function check() {
	const rows: { name: string; passed: boolean }[] = [];
	const assert = (name: string, passed: boolean) => {
		rows.push({ name, passed });
		if (!passed) throw new Error(name);
	};
	for (const reason of [
		"blur",
		"escape",
		"unmount",
		"delete",
		"collection",
		"time",
		"disable",
		"resize",
		"replace",
		"undo",
	]) {
		const f = mount();
		await delay();
		const node = box();
		mouse(node, "mousedown", 500);
		mouse(window, "mousemove", 600);
		await delay();
		assert(
			`${reason}/live-move`,
			Math.abs(f.context.project.timeline.textSegments[0].center.x - 0.6) <
				1e-5,
		);
		mouse(window, "mousemove", 700);
		await frame();
		if (reason === "blur") window.dispatchEvent(new Event("blur"));
		if (reason === "escape")
			document.body.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
		if (reason === "unmount") f.hide(false);
		if (reason === "delete")
			f.context.setProject("timeline", "textSegments", []);
		if (reason === "collection")
			f.context.setProject(
				"timeline",
				produce((value) => {
					Reflect.deleteProperty(value, "textSegments");
				}),
			);
		if (reason === "time") f.context.setEditorState("previewTime", 10);
		if (reason === "disable")
			f.context.setProject("timeline", "textSegments", 0, "enabled", false);
		if (reason === "resize") f.width(800);
		if (reason === "replace")
			f.context.setProject(
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
			document.body.dispatchEvent(
				new KeyboardEvent("keydown", {
					code: "KeyZ",
					metaKey: true,
					bubbles: true,
				}),
			);
		assert(`${reason}/history-ended`, !f.context.projectHistory.isPaused());
		await delay();
		const x = f.context.project.timeline.textSegments?.[0]?.center.x;
		const expected =
			reason === "delete" || reason === "collection"
				? undefined
				: reason === "replace" || reason === "undo"
					? 0.5
					: 0.6;
		assert(
			`${reason}/queued-commit-cancelled x=${x} expected=${expected}`,
			expected === undefined ? x === undefined : Math.abs(x - expected) < 1e-5,
		);
		const saved = JSON.stringify(f.context.project);
		mouse(window, "mousemove", 900);
		mouse(window, "mouseup", 900, 0);
		await delay();
		assert(
			`${reason}/no-stale-writes`,
			JSON.stringify(f.context.project) === saved,
		);
	}
	const f = mount();
	await delay();
	const node = box();
	mouse(node, "mousedown", 500);
	mouse(window, "mouseup", 500, 0);
	assert("selection/no-undo-entry", !f.context.projectHistory.canUndo());
	mouse(node, "mousedown", 500);
	mouse(window, "mousemove", 600);
	await delay();
	mouse(window, "mouseup", 650, 0);
	await delay();
	assert(
		"release/exact-final",
		Math.abs(f.context.project.timeline.textSegments[0].center.x - 0.65) <
			1e-5 && !f.context.projectHistory.isPaused(),
	);
	f.context.projectHistory.undo();
	await delay();
	assert(
		"release/undo",
		Math.abs(f.context.project.timeline.textSegments[0].center.x - 0.5) < 1e-5,
	);
	f.context.projectHistory.redo();
	await delay();
	assert(
		"release/redo",
		Math.abs(f.context.project.timeline.textSegments[0].center.x - 0.65) < 1e-5,
	);
	f.hide(false);
	const saved = JSON.stringify(f.context.project);
	mouse(node, "mousedown", 500);
	mouse(window, "mousemove", 800);
	await delay();
	mouse(window, "mouseup", 800, 0);
	assert(
		"disposed/no-new-drag",
		!f.context.projectHistory.isPaused() &&
			JSON.stringify(f.context.project) === saved,
	);

	const replaced = mount();
	await delay();
	box().dispatchEvent(new MouseEvent("dblclick", { bubbles: true, button: 0 }));
	let input = document.querySelector("textarea");
	if (!(input instanceof HTMLTextAreaElement))
		throw new Error("Missing inline editor");
	input.value = "";
	input.dispatchEvent(new InputEvent("input", { bubbles: true }));
	replaced.context.setProject(
		"timeline",
		"textSegments",
		produce((items) => {
			items.splice(0, 1, {
				...defaultTextSegment(2, 6),
				content: "Replacement",
			});
		}),
	);
	await delay();
	assert(
		"inline/keeps-replacement",
		replaced.context.project.timeline.textSegments.length === 1 &&
			replaced.context.project.timeline.textSegments[0].content ===
				"Replacement" &&
			!replaced.context.projectHistory.isPaused(),
	);
	const empty = mount();
	await delay();
	box().dispatchEvent(new MouseEvent("dblclick", { bubbles: true, button: 0 }));
	input = document.querySelector("textarea");
	if (!(input instanceof HTMLTextAreaElement))
		throw new Error("Missing empty editor");
	input.value = "";
	input.dispatchEvent(new InputEvent("input", { bubbles: true }));
	input.dispatchEvent(new FocusEvent("blur"));
	assert(
		"inline/deletes-own-empty",
		empty.context.project.timeline.textSegments.length === 0 &&
			!empty.context.projectHistory.isPaused(),
	);
	return { rows, passed: rows.every((row) => row.passed) };
}
Object.assign(window, { gestureProbe: { mount, check } });
