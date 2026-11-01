(async () => {
	const wait = () => new Promise((resolve) => setTimeout(resolve, 25));
	await wait();
	const probe = window.dragProbe;
	const box = () =>
		document.querySelector(".pointer-events-auto[style*='width:']");
	const rect = () => {
		const style = box().style;
		return {
			x: Number.parseFloat(style.left),
			y: Number.parseFloat(style.top),
			w: Number.parseFloat(style.width),
			h: Number.parseFloat(style.height),
		};
	};
	const mouse = async (target, type, x, y) => {
		target.dispatchEvent(
			new MouseEvent(type, {
				bubbles: true,
				button: 0,
				clientX: x,
				clientY: y,
				shiftKey: true,
			}),
		);
		await wait();
	};
	const report = (value) =>
		probe.setLayout({
			...probe.layout(),
			display: [
				value.x * 2.4,
				value.y * 2.4,
				(value.x + value.w) * 2.4,
				(value.y + value.h) * 2.4,
			],
		});
	const same = (a, b) =>
		["x", "y", "w", "h"].every((key) => Math.abs(a[key] - b[key]) < 0.01);
	await mouse(box(), "mousedown", 200, 200);
	await mouse(window, "mousemove", 257, 231);
	await mouse(window, "mouseup", 257, 231);
	const released = rect();
	report({ ...released, x: 95, y: 50 });
	await wait();
	const stale = rect();
	report(released);
	await wait();
	const acknowledged = rect();
	report({ ...released, x: 82, y: 46 });
	await wait();
	const afterAcknowledgement = rect();
	probe.setProject("background", "displayPosition", { x: 0.1, y: 0.5 });
	probe.setLayout({ ...probe.layout(), display: [-576, 108, 960, 972] });
	probe.setEditorState("canvasSelection", { type: "display" });
	await mouse(
		box().querySelector("[class*='cursor-se-resize']"),
		"mousedown",
		400,
		405,
	);
	await mouse(window, "mousemove", 370, 375);
	await mouse(window, "mouseup", 370, 375);
	const resized = rect();
	window.__report = {
		released,
		stale,
		acknowledged,
		afterAcknowledgement,
		resized,
		passed:
			same(released, stale) &&
			same(released, acknowledged) &&
			Math.abs(afterAcknowledgement.x - 82) < 0.01 &&
			Math.abs(resized.x + resized.w / 2 - 80) < 0.01 &&
			Math.abs(resized.y + resized.h / 2 - 225) < 0.01,
	};
})().catch((error) => {
	window.__report = { passed: false, error: String(error) };
});
