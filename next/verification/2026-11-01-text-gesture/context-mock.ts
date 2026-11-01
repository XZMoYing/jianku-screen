import { createStore, produce } from "solid-js/store";
import { createStoreHistory } from "../../cap/apps/desktop/src/routes/editor/project-history";
import { defaultTextSegment } from "../../cap/apps/desktop/src/routes/editor/text";
export const FPS = 60;
export function fixture() {
	const [project, setProject] = createStore({
		timeline: {
			textSegments: [defaultTextSegment(2, 6)],
			maskSegments: [],
			imageSegments: [],
			audioSegments: [{ start: 2, end: 6 }],
		},
	});
	const [editorState, setEditorState] = createStore({
		previewTime: null as number | null,
		playbackTime: 0,
		timeline: { selection: null, pendingTextEdit: null },
	});
	const projectHistory = createStoreHistory(project, setProject, () =>
		setEditorState("timeline", "selection", null),
	);
	return {
		project,
		setProject,
		editorState,
		setEditorState,
		projectHistory,
		setSnapGuides: () => {},
		projectActions: {
			deleteTextSegments: (indices: number[]) =>
				setProject(
					"timeline",
					"textSegments",
					produce((items) => {
						for (const index of [...indices].sort((a, b) => b - a))
							items.splice(index, 1);
					}),
				),
		},
	};
}
export let context: ReturnType<typeof fixture>;
export function reset() {
	context = fixture();
	return context;
}
export function useEditorContext() {
	return context;
}
