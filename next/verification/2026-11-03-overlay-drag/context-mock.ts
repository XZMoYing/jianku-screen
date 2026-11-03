import { createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { createStoreHistory } from "../../cap/apps/desktop/src/routes/editor/project-history";
import { defaultStyleSegment } from "../../cap/apps/desktop/src/routes/editor/style";
import type {
	ImageSegment,
	StyleSegment,
} from "../../cap/apps/desktop/src/utils/tauri";

type Kind = "style" | "image";
function image(start: number, track = 0): ImageSegment {
	return {
		start,
		end: start + 4,
		track,
		enabled: true,
		path: "assets/test.png",
		name: "Image",
		center: { x: 0.5, y: 0.5 },
		size: { x: 0.3, y: 0.3 },
		opacity: 0.8,
		rotation: 12,
		rounding: 8,
		flipX: true,
		flipY: false,
		lockAspect: true,
	};
}
function fixture(kind: Kind) {
	const [project, setProject] = createStore({
		timeline: {
			styleSegments: [
				defaultStyleSegment(20, 24, 1),
				defaultStyleSegment(2, 6),
				defaultStyleSegment(10, 14),
			],
			imageSegments: [image(20, 1), image(2), image(10)],
		},
	});
	const [editorState, setEditorState] = createStore({
		previewTime: null as number | null,
		playbackTime: 0,
		importingImage: false,
		timeline: {
			interactMode: "seek",
			transform: { position: 0, zoom: 10 },
			selection: null as { type: Kind; indices: number[] } | null,
		},
	});
	const [scale, setScale] = createSignal(0.01);
	const [total, setTotal] = createSignal(40);
	const history = createStoreHistory(project, setProject);
	let resumes = 0;
	const items = (): (StyleSegment | ImageSegment)[] =>
		kind === "style"
			? project.timeline.styleSegments
			: project.timeline.imageSegments;
	const change = (
		index: number,
		changes: { start?: number; end?: number; track?: number; name?: string },
	) => {
		if (kind === "style")
			setProject("timeline", "styleSegments", index, changes);
		else setProject("timeline", "imageSegments", index, changes);
	};
	const reorder = () => {
		if (kind === "style")
			setProject(
				"timeline",
				"styleSegments",
				produce((values) => {
					const last = values.pop();
					if (last) values.unshift(last);
				}),
			);
		else
			setProject(
				"timeline",
				"imageSegments",
				produce((values) => {
					const last = values.pop();
					if (last) values.unshift(last);
				}),
			);
	};
	const remove = () => {
		if (kind === "style") setProject("timeline", "styleSegments", []);
		else setProject("timeline", "imageSegments", []);
	};
	return {
		project,
		setProject,
		editorState,
		setEditorState,
		items,
		change,
		reorder,
		remove,
		scale,
		setScale,
		totalDuration: total,
		setTotal,
		projectHistory: {
			...history,
			pause: () => {
				const finish = history.pause();
				return () => {
					resumes++;
					finish();
				};
			},
		},
		counts: () => ({ resumes }),
		projectActions: {
			splitOverlaySegment: () => {},
			addStyleSegment: () => {},
			importImageSegment: async () => {},
		},
	};
}

export let context: ReturnType<typeof fixture>;
export function reset(kind: Kind) {
	context = fixture(kind);
	return context;
}
export function useEditorContext() {
	return context;
}
