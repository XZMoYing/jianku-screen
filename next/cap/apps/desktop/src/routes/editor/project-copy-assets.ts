type UnknownRecord = Record<string, unknown>;

function pathOf(value: unknown): string | null {
	if (!value || typeof value !== "object") return null;
	const path = (value as UnknownRecord).path;
	return typeof path === "string" ? path : null;
}

function objectOf(value: unknown): UnknownRecord | null {
	return value && typeof value === "object" ? (value as UnknownRecord) : null;
}

function arrayOf(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function sourceOf(value: unknown): unknown {
	return objectOf(value)?.source;
}

function normalizeAssetPath(path: string) {
	return path
		.replace(/^asset:\/\/localhost\//, "/")
		.replace(/^asset:\/\//, "")
		.replace(/^localhost\/\//, "/");
}

export function isExternalProjectAssetPath(path: string): boolean {
	const normalized = normalizeAssetPath(path.trim());
	if (!normalized) return false;
	if (normalized.startsWith("/") || /^[A-Za-z]:[\\/]/.test(normalized))
		return true;
	const segments = normalized.split(/[\\/]+/);
	return segments.includes("..");
}

export function collectExternalProjectAssets(project: unknown): string[] {
	const root = objectOf(project);
	if (!root) return [];
	const found: string[] = [];
	const seen = new Set<string>();
	const push = (path: string | null) => {
		if (!path || !isExternalProjectAssetPath(path) || seen.has(path)) return;
		seen.add(path);
		found.push(path);
	};
	push(pathOf(sourceOf(root.background)));
	const timeline = objectOf(root.timeline);
	if (timeline) {
		for (const segment of arrayOf(timeline.imageSegments))
			push(pathOf(segment));
		for (const segment of arrayOf(timeline.audioSegments))
			push(pathOf(segment));
		for (const segment of arrayOf(timeline.styleSegments)) {
			const overrides = objectOf(objectOf(segment)?.overrides);
			push(pathOf(sourceOf(overrides?.background)));
		}
	}
	return found;
}
