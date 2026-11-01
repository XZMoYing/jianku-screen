import { createComputed, createSignal, onCleanup, untrack } from "solid-js";

type MouseDrag = {
	isValid(): boolean;
	update(event: MouseEvent): void;
	finish(event?: MouseEvent): void;
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
		const finish = (event?: MouseEvent) => {
			if (ended) return;
			ended = true;
			window.removeEventListener("mousemove", move);
			window.removeEventListener("mouseup", release);
			window.removeEventListener("blur", interrupt);
			window.removeEventListener("keydown", keydown, true);
			setActive(null);
			drag.finish(event);
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
				finish(event);
			}
		};
		const keydown = (event: KeyboardEvent) => {
			if (
				(event.ctrlKey || event.metaKey) &&
				(event.code === "KeyZ" || event.code === "KeyY")
			) {
				finish();
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
