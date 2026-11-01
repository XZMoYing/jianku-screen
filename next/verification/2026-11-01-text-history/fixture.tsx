import { batch } from "solid-js";
import { render } from "solid-js/web";
import { TextOverlay } from "../../cap/apps/desktop/src/routes/editor/TextOverlay";
import { reset } from "./context-mock";

async function check() {
	const rows: { name: string; passed: boolean }[] = [];
	const assert = (name: string, passed: boolean) => {
		rows.push({ name, passed });
		if (!passed) throw new Error(name);
	};
	let context: ReturnType<typeof reset> | undefined;
	const dispose = render(() => {
		context = reset();
		return <TextOverlay size={{ width: 1000, height: 562.5 }} />;
	}, document.getElementById("root") as HTMLElement);
	if (!context) throw new Error("No fixture context");
	const c = context;
	const frames = async () => {
		await document.fonts.ready;
		await new Promise<void>((r) =>
			requestAnimationFrame(() => requestAnimationFrame(() => r())),
		);
	};
	try {
		assert("no-edits-before-visible", !c.projectHistory.canUndo());
		const resume = c.projectHistory.pause();
		c.setProject("timeline", "audioSegments", 0, { start: 11, end: 15 });
		resume();
		c.projectHistory.undo();
		assert(
			"undo-audio",
			c.project.timeline.audioSegments[0].start === 2 &&
				c.projectHistory.canRedo(),
		);
		c.setEditorState("previewTime", 3);
		await frames();
		const first = { ...c.project.timeline.textSegments[0].size };
		assert(
			"real-font-metrics-stored",
			first.x > 0 && first.y > 0 && first.x !== 0.1,
		);
		assert("redo-survives-first-visible-measure", c.projectHistory.canRedo());
		c.projectHistory.redo();
		await frames();
		assert("redo-audio", c.project.timeline.audioSegments[0].start === 11);
		c.setProject("timeline", "textSegments", 0, "fontSize", 96);
		await frames();
		assert(
			"font-resize-measured",
			c.project.timeline.textSegments[0].size.x > first.x * 1.7,
		);
		c.projectHistory.undo();
		await frames();
		assert(
			"undo-font-only",
			c.project.timeline.textSegments[0].fontSize === 48 &&
				c.project.timeline.audioSegments[0].start === 11,
		);
		assert("redo-survives-restored-font-measure", c.projectHistory.canRedo());
		c.projectHistory.redo();
		await frames();
		assert("redo-font", c.project.timeline.textSegments[0].fontSize === 96);
		c.projectHistory.undo();
		await frames();
		c.projectHistory.undo();
		await frames();
		assert("undo-in-order", c.project.timeline.audioSegments[0].start === 2);
		assert("derived-layout-has-no-extra-undo", !c.projectHistory.canUndo());
		batch(() => {
			c.setProject("timeline", "audioSegments", 0, "start", 13);
			c.projectHistory.applyDerived(() =>
				c.setProject("timeline", "textSegments", 0, "size", "x", first.x),
			);
		});
		assert("pending-user-edit-recorded", c.projectHistory.canUndo());
		c.projectHistory.undo();
		await frames();
		assert(
			"pending-user-edit-undo",
			c.project.timeline.audioSegments[0].start === 2,
		);
		c.projectHistory.redo();
		await frames();
		assert(
			"pending-user-edit-redo",
			c.project.timeline.audioSegments[0].start === 13,
		);

		return {
			rows,
			firstMetric: first,
			passed: rows.every((row) => row.passed),
		};
	} finally {
		dispose();
	}
}
Object.assign(window, { historyProbe: { check } });
