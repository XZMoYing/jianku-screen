import { createRoot } from "solid-js";
import { createStore } from "solid-js/store";
import { afterEach, expect, it } from "vitest";
import { createStoreHistory } from "./project-history";

let dispose: (() => void) | undefined;
afterEach(() => dispose?.());
function mount() {
	return createRoot((end) => {
		dispose = end;
		const [state, setState] = createStore({
			start: 2,
			end: 6,
			name: "Original",
		});
		return { state, setState, history: createStoreHistory(state, setState) };
	});
}
it("does not create undo for a pause without changes", () => {
	const f = mount();
	const resume = f.history.pause();
	resume();
	expect(f.history.canUndo()).toBe(false);
});
it("does not create undo after moving back to the initial state", () => {
	const f = mount();
	const resume = f.history.pause();
	f.setState("start", 3);
	f.setState("start", 2);
	resume();
	expect(f.history.canUndo()).toBe(false);
});
it("keeps the redo branch after a cancelled edit", () => {
	const f = mount();
	const first = f.history.pause();
	f.setState("start", 8);
	first();
	f.history.undo();
	expect(f.state.start).toBe(2);
	const cancel = f.history.pause();
	f.setState("start", 3);
	f.setState("start", 2);
	cancel();
	expect(f.history.canRedo()).toBe(true);
	f.history.redo();
	expect(f.state.start).toBe(8);
});
it("records one actual transaction without prior toolbar reads", () => {
	const f = mount();
	const resume = f.history.pause();
	f.setState("start", 3);
	f.setState("end", 7);
	resume();
	f.history.undo();
	expect(f.state).toMatchObject({ start: 2, end: 6 });
	f.history.redo();
	expect(f.state).toMatchObject({ start: 3, end: 7 });
});
it("keeps property edits when only the range was reverted", () => {
	const f = mount();
	const resume = f.history.pause();
	f.setState("start", 3);
	f.setState("name", "Updated");
	f.setState("start", 2);
	resume();
	f.history.undo();
	expect(f.state.name).toBe("Original");
	f.history.redo();
	expect(f.state).toMatchObject({ start: 2, name: "Updated" });
});
it("compares the outer baseline even when nested pauses resume out of order", () => {
	const f = mount();
	const outer = f.history.pause();
	f.setState("start", 3);
	const inner = f.history.pause();
	outer();
	inner();
	f.history.undo();
	expect(f.state.start).toBe(2);
	f.history.redo();
	expect(f.state.start).toBe(3);
});
it("treats duplicate resume as a no-op and still records later edits", () => {
	const f = mount();
	const resume = f.history.pause();
	resume();
	resume();
	expect(f.history.isPaused()).toBe(false);
	const next = f.history.pause();
	f.setState("start", 8);
	expect(f.history.isPaused()).toBe(true);
	next();
	f.history.undo();
	expect(f.state.start).toBe(2);
});
