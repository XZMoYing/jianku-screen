import { createStore } from "solid-js/store";
import { createAudioTrackSegment } from "../../cap/apps/desktop/src/routes/editor/audio";
import { defaultMaskSegment } from "../../cap/apps/desktop/src/routes/editor/masks";
import { defaultTextSegment } from "../../cap/apps/desktop/src/routes/editor/text";

export function fixture() {
	const [project, setProject] = createStore({
		timeline: {
			textSegments: [defaultTextSegment(2, 6), defaultTextSegment(10, 14)],
			maskSegments: [defaultMaskSegment(2, 6), defaultMaskSegment(10, 14)],
			audioSegments: [2, 10].map((start, index) =>
				createAudioTrackSegment({
					start,
					end: start + 4,
					track: 0,
					path: `/synthetic/${index}.wav`,
					name: index === 0 ? "A" : "B",
					duration: 60,
				}),
			),
		},
	});
	const [editorState, setEditorState] = createStore({
		previewTime: null as number | null,
		playbackTime: 0,
		timeline: {
			interactMode: "seek",
			transform: { position: 0, zoom: 20 },
			selection: null as {
				type: "text" | "mask" | "audio";
				indices: number[];
			} | null,
			audioPicker: null as number | null,
			hoveredTrack: null as string | null,
			hoveredMaskIndex: null as number | null,
			hoveredMaskTime: null as number | null,
		},
	});
	let pauses = 0;
	let resumes = 0;
	let playheadUpdates = 0;
	return {
		project,
		setProject,
		editorState,
		setEditorState,
		totalDuration: () => 60,
		projectHistory: {
			pause: () => {
				pauses++;
				return () => {
					resumes++;
				};
			},
		},
		projectActions: {},
		canvasControls: () => undefined,
		handleUpdatePlayhead: () => {
			playheadUpdates++;
		},
		counts: () => ({ pauses, resumes, playheadUpdates }),
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
