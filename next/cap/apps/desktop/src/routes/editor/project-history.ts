import { trackStore } from "@solid-primitives/deep";
import { createEventListener } from "@solid-primitives/event-listener";
import { createUndoHistory } from "@solid-primitives/history";
import { batch, createSignal } from "solid-js";
import { type createStore, reconcile, unwrap } from "solid-js/store";

export function createStoreHistory<T extends Static>(
	state: T,
	setState: ReturnType<typeof createStore<T>>[1],
	onRestore?: () => void,
) {
	const [pauseCount, setPauseCount] = createSignal(0);
	let derivedWriteDepth = 0;
	let pauseSnapshot: string | undefined;

	const history = createUndoHistory(() => {
		if (pauseCount() > 0) return;

		trackStore(state);
		if (derivedWriteDepth > 0) return;

		const copy = structuredClone(unwrap(state));

		return () => {
			onRestore?.();
			setState(reconcile(copy));
		};
	});

	createEventListener(window, "keydown", (e) => {
		switch (e.code) {
			case "KeyZ": {
				if (!(e.ctrlKey || e.metaKey)) return;
				if (e.shiftKey) history.redo();
				else history.undo();
				break;
			}
			case "KeyY": {
				if (!(e.ctrlKey || e.metaKey)) return;
				history.redo();
				break;
			}
			default: {
				return;
			}
		}

		e.preventDefault();
		e.stopPropagation();
	});

	function applyDerived(write: () => void) {
		history.canUndo();
		history.canRedo();
		derivedWriteDepth++;
		try {
			batch(() => {
				try {
					write();
				} finally {
					// Evaluate while guarded: deferred history reads would otherwise
					// turn measured layout into a new edit and discard the redo branch.
					history.canUndo();
					history.canRedo();
				}
			});
		} finally {
			derivedWriteDepth--;
		}
	}

	return Object.assign(history, {
		applyDerived,
		pause() {
			if (pauseCount() === 0) {
				history.canUndo();
				history.canRedo();
				pauseSnapshot = JSON.stringify(unwrap(state));
			}
			setPauseCount(pauseCount() + 1);
			let resumed = false;
			return () => {
				if (resumed) return;
				resumed = true;
				const remaining = pauseCount() - 1;
				if (remaining > 0) {
					setPauseCount(remaining);
					return;
				}
				const unchanged = JSON.stringify(unwrap(state)) === pauseSnapshot;
				pauseSnapshot = undefined;
				if (unchanged) applyDerived(() => setPauseCount(0));
				else setPauseCount(0);
			};
		},
		isPaused: () => pauseCount() > 0,
	});
}

type Static<T = unknown> =
	| {
			[K in number | string]: T;
	  }
	| T[];
