import type { Cursors, CursorType } from "~/utils/tauri";

export type CursorFamily = "macos" | "tahoe" | "windows";
export type CursorStyle = CursorFamily | "auto" | "circle";

export function selectedCursorStyle(type: CursorType): CursorStyle {
	return type === "pointer" ? "auto" : type;
}

export function cursorStyleOrder(platform: string): CursorStyle[] {
	return platform === "windows"
		? ["auto", "windows", "macos", "tahoe", "circle"]
		: ["auto", "macos", "tahoe", "windows", "circle"];
}

export function cursorStyleDescription(style: CursorStyle): string {
	switch (style) {
		case "auto":
			return "Keeps the cursor shapes and appearance from your recording.";
		case "macos":
			return "Classic macOS appearance. Custom cursors keep their recorded shape.";
		case "tahoe":
			return "macOS Tahoe appearance. Custom cursors keep their recorded shape.";
		case "windows":
			return "Windows appearance. Custom cursors keep their recorded shape.";
		case "circle":
			return "Replaces all cursor shapes with a circle.";
	}
}

function cursorFamilyFromShape(
	shape: string | null | undefined,
): CursorFamily | undefined {
	if (!shape) return undefined;
	const [namespace, name] = shape.split("|");
	if (namespace === "Windows") return "windows";
	if (namespace === "MacOS")
		return name?.startsWith("Tahoe") ? "tahoe" : "macos";
	return undefined;
}

export function recordedCursorFamily(
	meta: { type: "single" } | { type: "multiple"; cursors?: Cursors | null },
): CursorFamily | undefined {
	if (meta.type !== "multiple") return undefined;
	for (const cursor of Object.values(meta.cursors ?? {})) {
		if (typeof cursor === "string") continue;
		const family = cursorFamilyFromShape(cursor.shape);
		if (family) return family;
	}
	return undefined;
}
