import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import type { FrameLayoutEvent, XY } from "~/utils/tauri";

export const FPS = 60;
const [project, setProject] = createStore({
	aspectRatio: null as string | null,
	background: { padding: 10, displayPosition: null as XY<number> | null },
	camera: {
		position: { x: "right", y: "bottom" },
		manualPosition: null as XY<number> | null,
		size: 60,
	},
	timeline: {
		zoomSegments: [],
		sceneSegments: [],
		textSegments: [],
		maskSegments: [],
		imageSegments: [],
	},
});
const [editorState, setEditorState] = createStore({
	playing: false,
	playbackTime: 0,
	previewTime: null as number | null,
	canvasSelection: null as { type: "display" | "camera" } | null,
	timeline: { selection: null },
});
const [layout, setLayout] = createSignal<FrameLayoutEvent>({
	display: [192, 108, 1728, 972],
	camera: null,
	output_width: 1920,
	output_height: 1080,
});
const [scope, setScope] = createSignal({});
let resumed = 0;
const context = {
	project,
	editorInstance: {
		recordings: { segments: [{ display: { width: 1920, height: 1080 } }] },
	},
	styleProject: project,
	setStyleProject: setProject,
	selectedStyle: () => undefined,
	toggleStyleGroup: () => {},
	styleScopeToken: scope,
	editorState,
	setEditorState,
	latestFrameLayout: layout,
	setSnapGuides: () => {},
	projectHistory: { pause: () => () => resumed++ },
};
export const useEditorContext = () => context;
export const probe = {
	project,
	layout,
	setLayout,
	setProject,
	setEditorState,
	setScope,
	resumed: () => resumed,
};
