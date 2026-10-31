let pending = Promise.resolve();

export function enqueueWindowLevelUpdate<T>(update: () => Promise<T>) {
	const result = pending.then(update);
	pending = result.then(
		() => undefined,
		() => undefined,
	);
	return result;
}

export function setMainWindowPinned(
	window: {
		label: string;
		isAlwaysOnTop(): Promise<boolean>;
		setAlwaysOnTop(value: boolean): Promise<void>;
	},
	settings: {
		get(): Promise<{ mainWindowAlwaysOnTop?: boolean } | undefined>;
		set(value: { mainWindowAlwaysOnTop: boolean }): Promise<void>;
	},
	value: boolean,
) {
	return enqueueWindowLevelUpdate(async () => {
		if (window.label !== "main")
			throw new Error("Only the main window can change this preference");
		const previous = (await settings.get())?.mainWindowAlwaysOnTop ?? false;
		const previousLevel = await window.isAlwaysOnTop();
		await window.setAlwaysOnTop(value);
		try {
			await settings.set({ mainWindowAlwaysOnTop: value });
		} catch (error) {
			const errors: unknown[] = [error];
			for (const rollback of [
				() => window.setAlwaysOnTop(previousLevel),
				() => settings.set({ mainWindowAlwaysOnTop: previous }),
			]) {
				try {
					await rollback();
				} catch (failure) {
					errors.push(failure);
				}
			}
			if (errors.length > 1)
				throw new AggregateError(
					errors,
					"Could not restore window pin preference",
				);
			throw error;
		}
	});
}
