export type TitleSaveRegistration = {
	flush: () => Promise<void>;
	setReadOnly: (readOnly: boolean) => void;
};

type SaveRequest = { requestId: string };

export function createEditorTitleSaveBridge(options: {
	listen: (
		event: "editor-title-save-request" | "editor-title-save-cancelled",
		handler: (payload: SaveRequest) => void,
	) => Promise<() => void>;
	acknowledge: (
		response: SaveRequest & { error: string | null },
	) => Promise<void>;
	onError: (error: unknown) => void;
}) {
	let disposed = false;
	let registration: TitleSaveRegistration | undefined;
	let active: SaveRequest | undefined;

	const cancelled = options.listen("editor-title-save-cancelled", (payload) => {
		if (disposed || active?.requestId !== payload.requestId) return;
		active = undefined;
		registration?.setReadOnly(false);
	});
	const requested = cancelled.then(() => {
		if (disposed) return;
		return options.listen(
			"editor-title-save-request",
			async ({ requestId }) => {
				if (disposed) return;
				const request = { requestId };
				active = request;
				const current = registration;
				current?.setReadOnly(true);
				let error: string | null = null;
				try {
					await current?.flush();
				} catch (cause) {
					error = cause instanceof Error ? cause.message : String(cause);
				}
				if (disposed || active !== request) return;
				try {
					await options.acknowledge({ requestId, error });
				} catch (cause) {
					options.onError(cause);
				}
			},
		);
	});
	void requested.catch(options.onError);

	return {
		register(value: TitleSaveRegistration | undefined) {
			if (disposed) return;
			registration = value;
			registration?.setReadOnly(active !== undefined);
		},
		getFlush: () => registration?.flush,
		dispose() {
			if (disposed) return;
			disposed = true;
			active = undefined;
			registration?.setReadOnly(false);
			registration = undefined;
			void cancelled.then((unlisten) => unlisten()).catch(() => {});
			void requested.then((unlisten) => unlisten?.()).catch(() => {});
		},
	};
}
