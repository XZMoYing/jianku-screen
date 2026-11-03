import { createComputed, createSignal, onCleanup, untrack } from "solid-js";

import {
	recordTimelineGesture,
	type TimelineGestureSnapshot,
} from "./gesture-diagnostics";

export type TimelineMouseDragEndReason = "release" | "cancel" | "history";

type EndCause =
	| "release"
	| "escape"
	| "blur"
	| "invalid"
	| "buttons"
	| "dispose"
	| "superseded"
	| "history"
	| "error";

type MouseDrag = {
	diagnostics?: { kind: "keyboard"; snapshot(): TimelineGestureSnapshot };
	isValid(): boolean;
	update(event: MouseEvent): void;
	finish(event?: MouseEvent, reason?: TimelineMouseDragEndReason): void;
};

export function createTimelineMouseDrag() {
	const [active, setActive] = createSignal<{
		isValid(): boolean;
		finish(cause: EndCause): void;
	} | null>(null);
	let disposed = false;
	createComputed(() => {
		const drag = active();
		if (drag && !drag.isValid()) untrack(() => drag.finish("invalid"));
	});
	onCleanup(() => {
		disposed = true;
		active()?.finish("dispose");
	});

	return (setup: () => MouseDrag | null) => {
		if (disposed) return;
		active()?.finish("superseded");
		const drag = setup();
		if (!drag) return;
		let ended = false;
		const startedAt = Date.now();
		let moves = 0;
		let buttons: number | null = null;
		const finish = (
			event?: MouseEvent,
			reason: TimelineMouseDragEndReason = "cancel",
			cause: EndCause = "invalid",
		) => {
			if (ended) return;
			ended = true;
			window.removeEventListener("mousemove", move);
			window.removeEventListener("mouseup", release);
			window.removeEventListener("blur", interrupt);
			window.removeEventListener("keydown", keydown, true);
			setActive(null);
			if (drag.diagnostics) {
				let snapshot: TimelineGestureSnapshot;
				try {
					snapshot = untrack(drag.diagnostics.snapshot);
				} catch {
					snapshot = { snapshotUnavailable: true };
				}
				void recordTimelineGesture({
					kind: drag.diagnostics.kind,
					cause,
					startedAt,
					elapsedMs: Date.now() - startedAt,
					moves,
					buttons,
					snapshot,
				});
			}
			drag.finish(event, reason);
		};
		const interrupt = () => finish(undefined, "cancel", "blur");
		const move = (event: MouseEvent) => {
			moves++;
			buttons = event.buttons;
			if ((event.buttons & 1) === 0 || !drag.isValid()) {
				finish(
					undefined,
					"cancel",
					(event.buttons & 1) === 0 ? "buttons" : "invalid",
				);
				return;
			}
			try {
				drag.update(event);
			} catch (error) {
				finish(undefined, "cancel", "error");
				throw error;
			}
		};
		const release = (event: MouseEvent) => {
			if (event.button !== 0) return;
			if (!drag.isValid()) {
				finish();
				return;
			}
			try {
				drag.update(event);
			} finally {
				finish(event, "release", "release");
			}
		};
		const keydown = (event: KeyboardEvent) => {
			if (
				(event.ctrlKey || event.metaKey) &&
				(event.code === "KeyZ" || event.code === "KeyY")
			) {
				finish(undefined, "history", "history");
				return;
			}
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopImmediatePropagation();
			finish(undefined, "cancel", "escape");
		};
		window.addEventListener("mousemove", move);
		window.addEventListener("mouseup", release);
		window.addEventListener("blur", interrupt);
		window.addEventListener("keydown", keydown, true);
		setActive({
			isValid: drag.isValid,
			finish: (cause) => finish(undefined, "cancel", cause),
		});
		return interrupt;
	};
}
