export type WorkspaceMode = "recording" | "presentation";

export function createWorkspaceModeChange(options: {
	current: () => WorkspaceMode;
	locked: () => boolean;
	presentationActive: () => boolean;
	onPresentationActive: () => void;
	beforeChange: () => Promise<void>;
	commit: (mode: WorkspaceMode) => void;
}) {
	let revision = 0;
	let disposed = false;
	const allowed = (mode: WorkspaceMode) => {
		if (options.locked()) return false;
		if (mode === "recording" && options.presentationActive()) {
			options.onPresentationActive();
			return false;
		}
		return true;
	};
	return {
		async change(mode: WorkspaceMode) {
			const generation = ++revision;
			if (disposed || !allowed(mode)) return false;
			if (mode === options.current()) return true;
			try {
				await options.beforeChange();
			} catch (error) {
				if (!disposed && generation === revision) throw error;
				return false;
			}
			if (
				disposed ||
				generation !== revision ||
				mode === options.current() ||
				!allowed(mode)
			)
				return false;
			options.commit(mode);
			return true;
		},
		dispose() {
			disposed = true;
			revision++;
		},
	};
}
