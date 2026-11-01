import { createTimelineMouseDrag } from "./Timeline/mouse-drag";

type DragState = { moved: boolean; commit: { clear(): void } };
type Point = { x: number; y: number };

export function createCanvasMouseDrag(options: {
	isValid(): boolean;
	context(): readonly unknown[];
	pauseHistory(): () => void;
	clearGuides(): void;
}) {
	const start = createTimelineMouseDrag();
	return function createMouseDownDrag<T extends DragState>(
		setup: () => T | null,
		update: (
			event: MouseEvent,
			state: T,
			initial: Point,
			final: boolean,
		) => void,
		onFinish?: (completed: boolean) => void,
	) {
		return (down: MouseEvent) => {
			if (down.button !== 0 || !options.isValid()) return;
			let cancel: (() => void) | undefined;
			cancel = start(() => {
				const state = setup();
				if (!state) return null;
				down.preventDefault();
				down.stopPropagation();
				const context = options.context();
				const initial = { x: down.clientX, y: down.clientY };
				let resume: (() => void) | undefined;
				let ended = false;
				let pending: MouseEvent | null = null;
				let frame: number | undefined;
				const apply = (event: MouseEvent, final: boolean) => {
					if (ended) return;
					if (!state.moved) {
						if (
							Math.hypot(event.clientX - initial.x, event.clientY - initial.y) <
							2
						)
							return;
						state.moved = true;
						resume = options.pauseHistory();
					}
					update(event, state, initial, final);
				};
				return {
					isValid: () => {
						const next = options.context();
						return (
							options.isValid() &&
							context.length === next.length &&
							context.every((value, index) => value === next[index])
						);
					},
					update: (event: MouseEvent) => {
						pending = event;
						if (frame !== undefined) return;
						frame = requestAnimationFrame(() => {
							frame = undefined;
							const next = pending;
							pending = null;
							try {
								if (next) apply(next, false);
							} catch (error) {
								cancel?.();
								throw error;
							}
						});
					},
					finish: (event?: MouseEvent) => {
						if (ended) return;
						if (frame !== undefined) cancelAnimationFrame(frame);
						frame = undefined;
						pending = null;
						state.commit.clear();
						let completed = false;
						try {
							if (event) {
								apply(event, true);
								completed = true;
							}
						} finally {
							ended = true;
							state.commit.clear();
							resume?.();
							options.clearGuides();
							onFinish?.(completed);
						}
					},
				};
			});
		};
	};
}
