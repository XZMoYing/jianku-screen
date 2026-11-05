import { onCleanup } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import WorkspaceLayout, { workspacePaneSize } from "./WorkspaceLayout";

vi.mock("~/utils/i18n", () => ({ t: (value: string) => value }));

let dispose: (() => void) | undefined;
let width = 1000;
let height = 800;
let resize: () => void;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;

beforeEach(() => {
	localStorage.clear();
	width = 1000;
	height = 800;
	frames = new Map();
	nextFrame = 0;
	vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
		() => width,
	);
	vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
		() => height,
	);
	vi.stubGlobal(
		"ResizeObserver",
		class {
			constructor(callback: ResizeObserverCallback) {
				resize = () => callback([], this as unknown as ResizeObserver);
			}
			observe() {}
			disconnect() {}
		},
	);
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		const id = ++nextFrame;
		frames.set(id, callback);
		return id;
	});
	vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});

afterEach(() => {
	dispose?.();
	dispose = undefined;
	document.body.innerHTML = "";
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function mount() {
	const removed = vi.fn();
	function Child() {
		onCleanup(removed);
		return <input aria-label="child" />;
	}
	dispose = render(
		() => (
			<WorkspaceLayout
				mode="recording"
				source="desktop"
				menuOpen={false}
				preview={<div>preview</div>}
				inspector={<div>inspector</div>}
			>
				<Child />
			</WorkspaceLayout>
		),
		document.body,
	);
	return { removed };
}
function element(selector: string): HTMLElement {
	const result = document.querySelector<HTMLElement>(selector);
	if (!result) throw new Error(`Missing ${selector}`);
	return result;
}
function pointer(
	target: EventTarget,
	type: string,
	x: number,
	y: number,
	pointerId = 1,
) {
	const event = new MouseEvent(type, {
		bubbles: true,
		cancelable: true,
		button: 0,
		clientX: x,
		clientY: y,
	});
	Object.defineProperty(event, "pointerId", { value: pointerId });
	target.dispatchEvent(event);
}
function flush() {
	const pending = [...frames.values()];
	frames.clear();
	for (const callback of pending) callback(0);
}
function value(axis: "column" | "row") {
	return Number(
		element(`.jk-workspace-divider-${axis}`).getAttribute("aria-valuenow"),
	);
}
function key(axis: "column" | "row", key: string) {
	element(`.jk-workspace-divider-${axis}`).dispatchEvent(
		new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
	);
}

it("applies pointer movement and the final pointer-up position on both axes", () => {
	mount();
	const side = element(".jk-workspace-divider-column");
	pointer(side, "pointerdown", 700, 500);
	pointer(window, "pointermove", 650, 500);
	flush();
	expect(value("column")).toBe(378);
	pointer(window, "pointerup", 610, 500);
	expect(value("column")).toBe(418);
	expect(element(".jk-workspace-body").dataset.resizing).toBe("false");
	const bottom = element(".jk-workspace-divider-row");
	pointer(bottom, "pointerdown", 500, 500);
	pointer(window, "pointermove", 500, 470);
	flush();
	expect(value("row")).toBe(284);
	pointer(window, "pointerup", 500, 430);
	expect(value("row")).toBe(324);
});

it("restores the stored value when a drag is cancelled by blur", () => {
	mount();
	key("column", "ArrowLeft");
	pointer(element(".jk-workspace-divider-column"), "pointerdown", 700, 0);
	pointer(window, "pointermove", 600, 0);
	flush();
	expect(value("column")).toBe(438);
	window.dispatchEvent(new Event("blur"));
	expect(value("column")).toBe(338);
	expect(element(".jk-workspace-body").dataset.resizing).toBe("false");
});

it("supports keyboard adjustments and resets", () => {
	mount();
	key("column", "ArrowLeft");
	key("row", "ArrowUp");
	expect(value("column")).toBe(338);
	expect(value("row")).toBe(264);
	key("column", "ArrowRight");
	key("row", "ArrowDown");
	expect(value("column")).toBe(328);
	expect(value("row")).toBe(254);
	key("column", "ArrowLeft");
	key("row", "ArrowUp");
	key("column", "Home");
	key("row", "Home");
	expect(value("column")).toBe(328);
	expect(value("row")).toBe(254);
});

it("clamps pane sizes and handles non-finite available and preferred sizes", () => {
	expect(workspacePaneSize(1000, 900, 292, 320, 620)).toBe(620);
	expect(workspacePaneSize(400, 900, 292, 320, 620)).toBe(200);
	expect(workspacePaneSize(Number.NaN, 300, 292, 320)).toBe(0);
	expect(workspacePaneSize(1000, Number.POSITIVE_INFINITY, 292, 320)).toBe(292);
	mount();
	pointer(element(".jk-workspace-divider-column"), "pointerdown", 700, 0);
	pointer(window, "pointerup", -1000, 0);
	expect(value("column")).toBe(620);
});

it("persists adjustments through remount and preserves child state through resize", () => {
	const { removed } = mount();
	const input = element('[aria-label="child"]') as HTMLInputElement;
	input.value = "preserved";
	key("column", "ArrowLeft");
	key("row", "ArrowUp");
	width = 500;
	height = 400;
	resize();
	expect(value("column")).toBe(244);
	expect(value("row")).toBe(208);
	expect(element('[aria-label="child"]')).toBe(input);
	expect(input.value).toBe("preserved");
	expect(removed).not.toHaveBeenCalled();
	width = 1000;
	height = 800;
	resize();
	expect(value("column")).toBe(338);
	expect(value("row")).toBe(264);
	dispose?.();
	dispose = undefined;
	mount();
	expect(value("column")).toBe(338);
	expect(value("row")).toBe(264);
});
