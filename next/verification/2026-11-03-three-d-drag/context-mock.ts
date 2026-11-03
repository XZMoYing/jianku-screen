import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { createStoreHistory } from "../../cap/apps/desktop/src/routes/editor/project-history";
import { newCamera3DShot } from "../../cap/apps/desktop/src/routes/editor/three-d";

function fixture(empty: boolean) {
	const [project, setProject] = createStore({
		timeline: {
			camera3dSegments: empty
				? []
				: [newCamera3DShot(2, 6), newCamera3DShot(10, 14)],
		},
	});
	const [editorState, setEditorState] = createStore({
		previewTime: null as number | null,
		playbackTime: 0,
		timeline: {
			interactMode: "seek",
			transform: { position: 0, zoom: 10 },
			selection: null as { type: "3d"; indices: number[] } | null,
			hoveredTrack: null as string | null,
			camera3dAutoPreview: null as number | null,
			camera3dPose: "start" as "start" | "end",
		},
	});
	const history = createStoreHistory(project, setProject);
	const [total, setTotal] = createSignal(60);
	const [scale, setScale] = createSignal(0.01);
	let resumes = 0;
	const ranges: number[][] = [];
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
		camera3DAutoScenePreview: () => [],
		projectActions: {
			addCamera3DShot: () => {},
			applyCamera3DAutoScene: () => {},
			addCamera3DShotRange: (start: number, end: number) =>
				ranges.push([start, end]),
			splitCamera3DSegment: () => {},
			selectCamera3DPose: () => {},
		},
		counts: () => ({ resumes, ranges }),
	};
}

export let context: ReturnType<typeof fixture>;
export function reset(empty: boolean) {
	context = fixture(empty);
	return context;
}
export function useEditorContext() {
	return context;
}
