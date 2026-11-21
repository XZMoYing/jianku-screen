import { t as localize } from "~/utils/i18n";
import type {
	ShapeAnimation,
	ShapeArrowHead,
	ShapeKind,
	ShapeSegment,
} from "~/utils/tauri";

export const SHAPE_DEFAULT_STROKE = "#F05656";
export const SHAPE_HIGHLIGHT_FILL = "#FFD60A";

export const SHAPE_KINDS: readonly ShapeKind[] = [
	"arrow",
	"line",
	"rectangle",
	"ellipse",
	"highlight",
	"badge",
];

export const SHAPE_ARROW_HEADS: readonly ShapeArrowHead[] = [
	"filled",
	"open",
	"double",
];

export const SHAPE_ANIMATIONS: readonly ShapeAnimation[] = [
	"none",
	"fade",
	"scale",
	"draw",
];

export const SHAPE_COLOR_SWATCHES = [
	"#F05656",
	"#F97316",
	"#FFD60A",
	"#22C55E",
	"#0EA5E9",
	"#3B82F6",
	"#FFFFFF",
	"#111827",
] as const;

export function shapeKindSupportsFill(kind: ShapeKind): boolean {
	return (
		kind === "rectangle" ||
		kind === "ellipse" ||
		kind === "highlight" ||
		kind === "badge"
	);
}

export function shapeKindSupportsCornerRadius(kind: ShapeKind): boolean {
	return kind === "rectangle" || kind === "highlight";
}

export function shapeKindLabel(kind: ShapeKind): string {
	switch (kind) {
		case "arrow":
			return "Arrow";
		case "line":
			return "Line";
		case "rectangle":
			return "Rectangle";
		case "ellipse":
			return "Ellipse";
		case "highlight":
			return "Highlight";
		case "badge":
			return "Step badge";
	}
}

export function shapeArrowHeadLabel(head: ShapeArrowHead): string {
	switch (head) {
		case "filled":
			return "Filled";
		case "open":
			return "Open";
		case "double":
			return "Double";
	}
}

export function shapeAnimationLabel(animation: ShapeAnimation): string {
	switch (animation) {
		case "none":
			return "None";
		case "fade":
			return "Fade";
		case "scale":
			return "Scale";
		case "draw":
			return "Draw";
	}
}

export function shapeDisplayName(segment: ShapeSegment): string {
	if (segment.kind === "badge") {
		return localize("Step {number}", { number: segment.number });
	}
	return localize(shapeKindLabel(segment.kind));
}

export function nextShapeBadgeNumber(
	segments: readonly ShapeSegment[],
): number {
	let max = 0;
	for (const segment of segments) {
		if (segment.kind === "badge" && segment.number > max) {
			max = segment.number;
		}
	}
	return max + 1;
}

export function shapeKindStyleDefaults(
	kind: ShapeKind,
): Pick<
	ShapeSegment,
	| "strokeColor"
	| "strokeWidth"
	| "fill"
	| "fillColor"
	| "fillOpacity"
	| "cornerRadius"
	| "arrowHead"
	| "shadow"
	| "opacity"
	| "animationIn"
	| "animationOut"
	| "animationInDuration"
	| "animationOutDuration"
> {
	const base = {
		strokeColor: SHAPE_DEFAULT_STROKE,
		strokeWidth: 6,
		fill: false,
		fillColor: SHAPE_DEFAULT_STROKE,
		fillOpacity: 0.2,
		cornerRadius: 12,
		arrowHead: "filled" as ShapeArrowHead,
		shadow: 0.3,
		opacity: 1,
		animationIn: "fade" as ShapeAnimation,
		animationOut: "fade" as ShapeAnimation,
		animationInDuration: 0.25,
		animationOutDuration: 0.2,
	};
	switch (kind) {
		case "arrow":
		case "line":
			return {
				...base,
				strokeWidth: 6,
				shadow: 0.3,
				animationIn: "draw",
				animationInDuration: 0.4,
			};
		case "rectangle":
		case "ellipse":
			return {
				...base,
				strokeWidth: 6,
				cornerRadius: 12,
				shadow: 0.3,
				animationIn: "draw",
				animationInDuration: 0.5,
			};
		case "highlight":
			return {
				...base,
				strokeWidth: 0,
				cornerRadius: 10,
				fill: true,
				fillColor: SHAPE_HIGHLIGHT_FILL,
				fillOpacity: 0.4,
				shadow: 0,
				animationIn: "fade",
				animationInDuration: 0.25,
			};
		case "badge":
			return {
				...base,
				strokeColor: "#FFFFFF",
				strokeWidth: 4,
				fill: true,
				fillOpacity: 1,
				shadow: 0.35,
				animationIn: "scale",
				animationInDuration: 0.3,
			};
	}
}

export function defaultShapeSegment(
	start: number,
	end: number,
	track: number,
	kind: ShapeKind = "arrow",
	aspect = 16 / 9,
	existing: readonly ShapeSegment[] = [],
): ShapeSegment {
	const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
	const dims: Record<ShapeKind, [number, number]> = {
		arrow: [0.16, 0.1],
		line: [0.18, 0],
		rectangle: [0.24, 0.15],
		ellipse: [0.18, 0.18],
		highlight: [0.28, 0.06],
		badge: [0.045, 0.045],
	};
	const [rawHalfW, halfH] = dims[kind];
	const halfW = rawHalfW / safeAspect;
	const styles = shapeKindStyleDefaults(kind);
	return {
		start,
		end,
		track,
		enabled: true,
		kind,
		from: { x: 0.5 - halfW, y: 0.5 - halfH },
		to: { x: 0.5 + halfW, y: 0.5 + halfH },
		...styles,
		number: nextShapeBadgeNumber(existing),
	};
}
