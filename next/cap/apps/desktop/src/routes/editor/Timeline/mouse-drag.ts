import { createComputed, createSignal, onCleanup, untrack } from "solid-js";

export type TimelineMouseDragEndReason = "release" | "cancel" | "history";

type MouseDrag = {
	isValid(): boolean;
	update(event: MouseEvent): void;
	finish(event?: MouseEvent, reason?: TimelineMouseDragEndReason): void;
};

export function createTimelineMouseDrag() {
	const [active, setActive] = createSignal<{
		isValid(): boolean;
		finish(): void;
	} | null>(null);
	let disposed = false;
	createComputed(() => {
		const drag = active();
		if (drag && !drag.isValid()) untrack(drag.finish);
	});
	onCleanup(() => {
		disposed = true;
		active()?.finish();
	});

	return (setup: () => MouseDrag | null) => {
		if (disposed) return;
		active()?.finish();
		const drag = setup();
		if (!drag) return;
		let ended = false;
		const finish = (
			event?: MouseEvent,
			reason: TimelineMouseDragEndReason = "cancel",
		) => {
			if (ended) return;
			ended = true;
			window.removeEventListener("mousemove", move);
			window.removeEventListener("mouseup", release);
			window.removeEventListener("blur", interrupt);
			window.removeEventListener("keydown", keydown, true);
			setActive(null);
			drag.finish(event, reason);
		};
		const interrupt = () => finish();
		const move = (event: MouseEvent) => {
			if ((event.buttons & 1) === 0 || !drag.isValid()) {
				finish();
				return;
			}
			try {
				drag.update(event);
			} catch (error) {
				finish();
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
				finish(event, "release");
			}
		};
		const keydown = (event: KeyboardEvent) => {
			if (
				(event.ctrlKey || event.metaKey) &&
				(event.code === "KeyZ" || event.code === "KeyY")
			) {
				finish(undefined, "history");
				return;
			}
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopImmediatePropagation();
			finish();
		};
		window.addEventListener("mousemove", move);
		window.addEventListener("mouseup", release);
		window.addEventListener("blur", interrupt);
		window.addEventListener("keydown", keydown, true);
		setActive({ isValid: drag.isValid, finish: interrupt });
		return interrupt;
	};
}
