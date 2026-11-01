import { render } from "solid-js/web";
import { CanvasElementsOverlay } from "~/routes/editor/CanvasElementsOverlay";
import { probe } from "./canvas-mocks";

declare global {
	interface Window {
		dragProbe: typeof probe;
	}
}
window.dragProbe = probe;
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
