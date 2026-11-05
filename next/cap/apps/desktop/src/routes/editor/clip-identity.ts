type ClipIdentity = { id?: string | null; start: number };

const existingIdentity = (segment: ClipIdentity) =>
	typeof segment.id === "string" && segment.id.trim().length > 0
		? segment.id
		: undefined;

export function normalizeClipIdentities<T extends ClipIdentity>(
	segments: readonly T[],
): Array<T & { id: string }> {
	const reserved = new Set(
		segments
			.map(existingIdentity)
			.filter((id): id is string => id !== undefined),
	);
	const used = new Set<string>();
	return segments.map((segment, index) => {
		const existing = existingIdentity(segment);
		if (existing && !used.has(existing)) {
			used.add(existing);
			return { ...segment, id: existing };
		}
		// Legacy IDs remain repeatable before the first save; edits retain the assigned ID.
		let id = `legacy-clip-${index}`;
		let suffix = 0;
		while (reserved.has(id) || used.has(id))
			id = `legacy-clip-${index}-${++suffix}`;
		used.add(id);
		return { ...segment, id };
	});
}

export function newClipInstance<T extends object>(
	segment: T,
): T & { id: string } {
	return { ...segment, id: `clip-${crypto.randomUUID()}` };
}

export function clipIndicesForIds(
	segments: readonly ClipIdentity[],
	ids: readonly string[],
) {
	const indices = new Map(
		segments.map((segment, index) => [segment.id, index]),
	);
	return ids.flatMap((id) => {
		const index = indices.get(id);
		return index === undefined ? [] : [index];
	});
}
