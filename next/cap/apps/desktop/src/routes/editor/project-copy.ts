export async function savePortableCopy(options: {
	flush: () => Promise<void>;
	pickDestination: () => Promise<string | null>;
	copy: (destination: string) => Promise<string>;
	open: (path: string) => Promise<unknown>;
	onSaved: (path: string) => void;
}) {
	const destination = await options.pickDestination();
	if (!destination) return null;
	await options.flush();
	const path = await options.copy(destination);
	options.onSaved(path);
	await options.open(path);
	return path;
}
