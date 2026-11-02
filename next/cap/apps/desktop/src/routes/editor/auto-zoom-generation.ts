export function createAutoZoomGeneration<T>(options: {
	snapshot: () => string;
	revision: () => number;
	flush: () => Promise<void>;
	generate: () => Promise<T[]>;
	apply: (segments: T[]) => void;
	setPending: (pending: boolean) => void;
	onEmpty: () => void;
	onStale: () => void;
	onError: (error: unknown) => void;
}) {
	let pending = false;
	let disposed = false;

	return {
		async run() {
			if (pending || disposed) return;
			pending = true;
			options.setPending(true);
			try {
				const snapshot = options.snapshot();
				await options.flush();
				if (disposed) return;
				if (options.snapshot() !== snapshot) {
					options.onStale();
					return;
				}
				const revision = options.revision();
				const segments = await options.generate();
				if (disposed) return;
				if (
					options.revision() !== revision ||
					options.snapshot() !== snapshot
				) {
					options.onStale();
					return;
				}
				if (segments.length === 0) options.onEmpty();
				else options.apply(segments);
			} catch (error) {
				if (!disposed) options.onError(error);
			} finally {
				pending = false;
				if (!disposed) options.setPending(false);
			}
		},
		dispose() {
			disposed = true;
		},
	};
}
