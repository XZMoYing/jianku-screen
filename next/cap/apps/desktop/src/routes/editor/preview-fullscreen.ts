type FullscreenWindow = {
	isFullscreen(): Promise<boolean>;
	setFullscreen(value: boolean): Promise<void>;
};

export function createPreviewFullscreen(options: {
	window: FullscreenWindow;
	changed: (active: boolean) => void;
	failed: (error: unknown) => void;
}) {
	let active = false;
	let desired = false;
	let original: boolean | undefined;
	let disposed = false;
	let pending: Promise<void> | undefined;

	const reconcile = async () => {
		try {
			while (desired !== active) {
				if (desired) {
					const wasFullscreen = await options.window.isFullscreen();
					if (!desired) continue;
					if (!wasFullscreen) await options.window.setFullscreen(true);
					original = wasFullscreen;
					active = true;
				} else {
					if (original === false) await options.window.setFullscreen(false);
					original = undefined;
					active = false;
				}
				if (!disposed && desired === active) options.changed(active);
			}
		} catch (error) {
			desired = active;
			if (!disposed) options.failed(error);
		}
	};

	const request = (enabled: boolean) => {
		desired = enabled && !disposed;
		pending ??= reconcile().finally(() => {
			pending = undefined;
			if (desired !== active) return request(desired);
		});
		return pending;
	};

	return {
		active: () => active,
		busy: () => pending !== undefined,
		request,
		async nativeChanged() {
			if (pending || !active) return;
			const nativeFullscreen = await options.window.isFullscreen();
			if (pending || !active || nativeFullscreen) return;
			desired = false;
			active = false;
			original = undefined;
			if (!disposed) options.changed(false);
		},
		dispose() {
			disposed = true;
			return request(false);
		},
	};
}
