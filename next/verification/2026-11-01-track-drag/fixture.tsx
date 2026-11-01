import { createSignal, Show } from "solid-js";
import { render } from "solid-js/web";
import { AudioTrack } from "../../cap/apps/desktop/src/routes/editor/Timeline/AudioTrack";
import { TimelineContextProvider } from "../../cap/apps/desktop/src/routes/editor/Timeline/context";
import { MaskTrack } from "../../cap/apps/desktop/src/routes/editor/Timeline/MaskTrack";
import { TextTrack } from "../../cap/apps/desktop/src/routes/editor/Timeline/TextTrack";
import { reset } from "./context-mock";

type Kind = "text" | "mask" | "audio";
let dispose: (() => void) | undefined;
function mount(kind: Kind) {
	dispose?.();
	const context = reset();
	const [shown, setShown] = createSignal(true);
	const [lane, setLane] = createSignal(0);
	const states: string[] = [];
	const shared = {
		onDragStateChanged: (state: { type: string }) => states.push(state.type),
		handleUpdatePlayhead: context.handleUpdatePlayhead,
	};
	dispose = render(
		() => (
			<TimelineContextProvider
				duration={60}
				secsPerPixel={0.02}
				timelineBounds={{
					left: 0,
					top: 0,
					right: 1000,
					bottom: 44,
					width: 1000,
					height: 44,
				}}
			>
				<Show when={shown()}>
					{kind === "text" ? (
						<TextTrack laneIndex={lane()} {...shared} />
					) : kind === "mask" ? (
						<MaskTrack laneIndex={lane()} {...shared} />
					) : (
						<AudioTrack
							laneIndex={lane()}
							onRequestAdd={() => {}}
							{...shared}
						/>
					)}
				</Show>
			</TimelineContextProvider>
		),
		document.getElementById("root") as HTMLElement,
	);
	const node = document.querySelector(`[data-${kind}-segment]`);
	const content = node?.querySelector(".cursor-grab");
	if (!node || !content) throw new Error("Missing real track");
	return { context, setShown, setLane, node, content, states };
}
function mouse(
	target: EventTarget,
	type: string,
	x: number,
	buttons = 1,
	button = 0,
) {
	target.dispatchEvent(
		new MouseEvent(type, { bubbles: true, clientX: x, buttons, button }),
	);
}
function checks() {
	const observations: { name: string; passed: boolean }[] = [];
	const check = (name: string, passed: boolean) => {
		observations.push({ name, passed });
		if (!passed) throw new Error(name);
	};
	for (const kind of ["text", "mask", "audio"] as const) {
		for (const reason of [
			"blur",
			"escape",
			"unmount",
			"mode",
			"lane",
			"delete",
		] as const) {
			const f = mount(kind);
			mouse(f.content, "mousedown", 200);
			mouse(window, "mousemove", 203);
			mouse(window, "mousemove", 253);
			if (reason === "blur") window.dispatchEvent(new Event("blur"));
			if (reason === "escape")
				window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
			if (reason === "unmount") f.setShown(false);
			if (reason === "mode")
				f.context.setEditorState("timeline", "interactMode", "split");
			if (reason === "lane") f.setLane(1);
			if (reason === "delete")
				f.context.setProject("timeline", `${kind}Segments`, []);
			const saved = JSON.stringify(f.context.project);
			check(
				`${kind}/${reason}/finish`,
				f.context.counts().resumes === 1 && f.states.at(-1) === "idle",
			);
			mouse(window, "mousemove", 553);
			mouse(window, "mouseup", 553, 0);
			check(
				`${kind}/${reason}/stale`,
				JSON.stringify(f.context.project) === saved &&
					f.context.counts().resumes === 1,
			);
		}
	}
	const f = mount("audio");
	const a = f.context.project.timeline.audioSegments[0];
	const b = f.context.project.timeline.audioSegments[1];
	f.context.setEditorState("timeline", "selection", {
		type: "audio",
		indices: [0],
	});
	mouse(f.content, "mousedown", 200);
	mouse(window, "mousemove", 203);
	mouse(window, "mousemove", 803);
	mouse(window, "mousemove", 853);
	mouse(window, "mouseup", 853, 0);
	check("audio/sorting/identity", a.start === 15 && b.start === 10);
	check(
		"audio/sorting/node",
		document.querySelector('[data-audio-segment][title="A"]') === f.node,
	);
	check(
		"audio/sorting/selection",
		f.context.editorState.timeline.selection?.indices[0] === 1,
	);
	return { observations, passed: observations.every((row) => row.passed) };
}
Object.assign(window, { trackProbe: { mount, checks } });
