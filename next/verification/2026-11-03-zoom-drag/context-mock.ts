import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { createStoreHistory } from "../../cap/apps/desktop/src/routes/editor/project-history";
import type { ZoomSegment } from "../../cap/apps/desktop/src/utils/tauri";
export function segment(start: number, end = start + 4): ZoomSegment {
	return {
		start,
		end,
		amount: 2,
		mode: "auto",
		glideDirection: "none",
		glideSpeed: 0.5,
		instantAnimation: false,
		edgeSnapRatio: 0.25,
	};
}
function fixture(segments: ZoomSegment[]) {
	const [project, setProject] = createStore({
		timeline: { zoomSegments: segments },
	});
	const [editorState, setEditorState] = createStore({
		previewTime: null as number | null,
		playbackTime: 0,
		timeline: {
			interactMode: "seek",
			transform: { position: 0, zoom: 10 },
			selection: null as { type: "zoom"; indices: number[] } | null,
			hoveredTrack: null as string | null,
		},
	});
	const history = createStoreHistory(project, setProject);
	let resumes = 0;
	const [total, setTotal] = createSignal(60);
	const [scale, setScale] = createSignal(0.01);
	return {
		project,
		setProject,
		editorState,
		setEditorState,
		totalDuration: total,
		setTotal,
		scale,
		setScale,
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
		meta: () => ({ hasRecordedCursorData: false }),
		flushProjectConfig: async () => {},
		projectRevision: () => 0,
		projectActions: {
			splitZoomSegment: () => {},
			deleteZoomSegments: () => {},
		},
	};
}

export let context: ReturnType<typeof fixture>;
export function reset(empty: boolean) {
	context = fixture(empty ? [] : [segment(2), segment(10)]);
	return context;
}
export function useEditorContext() {
	return context;
}
export function serializeProjectConfiguration(value: object) {
	return value;
}
