import { render } from "solid-js/web";
import { CanvasElementsOverlay } from "~/routes/editor/CanvasElementsOverlay";
import {
	displayResizeLayout,
	resolveDisplayResize,
} from "~/routes/editor/display-resize";
import { probe } from "./canvas-mocks";

declare global {
	interface Window {
		dragProbe: typeof probe;
		resizeExpected: () => ReturnType<typeof displayResizeLayout>;
		benchmarkResize: () => {
			iterations: number;
			elapsedMs: number;
			checksum: number;
		};
	}
}
window.dragProbe = probe;
window.resizeExpected = () =>
	displayResizeLayout(
		{
			imageSize: { width: 1920, height: 1080 },
			background: probe.project.background,
			aspectRatio: probe.project.aspectRatio,
			resolutionBase: { x: 1920, y: 1080 },
		},
		probe.project.background.padding,
	);
window.benchmarkResize = () => {
	const start = performance.now();
	let checksum = 0;
	for (let index = 0; index < 1000; index++) {
		checksum += resolveDisplayResize(
			{
				imageSize: { width: 1920, height: 1080 },
				background: probe.project.background,
				aspectRatio: probe.project.aspectRatio,
				resolutionBase: { x: 1920, y: 1080 },
			},
			0.4 + (index % 50) / 500,
		).padding;
	}
	return { iterations: 1000, elapsedMs: performance.now() - start, checksum };
};
const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
render(
	() => (
		<div style={{ position: "relative", width: "800px", height: "450px" }}>
			<CanvasElementsOverlay size={{ width: 800, height: 450 }} />
		</div>
	),
	root,
);
