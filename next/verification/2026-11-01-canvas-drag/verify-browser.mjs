import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const cap = path.resolve(directory, "../../cap");
const require = createRequire(path.join(cap, "apps/desktop/package.json"));
const { build } = await import(require.resolve("vite"));
const icons = require("unplugin-icons/vite").default;
const solid = (await import(require.resolve("vite-plugin-solid"))).default;
const { chromium } = require("playwright");
const solidPath = path.dirname(require.resolve("solid-js/package.json"));
const output = await mkdtemp(path.join(tmpdir(), "jianku-canvas-drag-"));
await build({
	configFile: false,
	root: directory,
	plugins: [icons({ compiler: "solid" }), solid()],
	resolve: {
		alias: [
			{
				find: /^\.\/context$/,
				replacement: path.join(directory, "canvas-mocks.ts"),
			},
			{
				find: "~/utils/i18n",
				replacement: path.join(directory, "i18n-mock.ts"),
			},
			{ find: "~", replacement: path.join(cap, "apps/desktop/src") },
			{
				find: /^solid-js$/,
				replacement: path.join(solidPath, "dist/solid.js"),
			},
			{
				find: /^solid-js\/store$/,
				replacement: path.join(solidPath, "store/dist/store.js"),
			},
			{
				find: /^solid-js\/web$/,
				replacement: path.join(solidPath, "web/dist/web.js"),
			},
		],
	},
	build: {
		lib: {
			entry: path.join(directory, "fixture.tsx"),
			name: "Fixture",
			formats: ["iife"],
			fileName: () => "fixture.js",
		},
		outDir: output,
		emptyOutDir: false,
	},
});
const code = await readFile(path.join(output, "fixture.js"), "utf8");
const html = `<style>body{padding:40px}.absolute{position:absolute}.inset-0{inset:0}.pointer-events-none{pointer-events:none}.pointer-events-auto{pointer-events:auto}.w-3{width:12px}.h-3{height:12px}.top-0{top:0}.left-0{left:0}.right-0{right:0}.bottom-0{bottom:0}</style><div id="root"></div><script>${code}</script>`;
await writeFile(path.join(output, "fixture.html"), html);
const webkitCheck = await readFile(
	path.join(directory, "webkit-check.js"),
	"utf8",
);
await writeFile(
	path.join(output, "webkit-fixture.html"),
	`${html}<script>${webkitCheck}</script>`,
);
const browser = await chromium.launch({
	headless: true,
	...(process.env.JIANKU_BROWSER_PATH
		? { executablePath: process.env.JIANKU_BROWSER_PATH }
		: {}),
});
const results = [];
try {
	for (const reducedMotion of ["no-preference", "reduce"]) {
		const page = await browser.newPage({ reducedMotion });
		await page.setContent(html);
		const box = page.locator(".pointer-events-auto[style*='width:']").first();
		const read = () =>
			box.evaluate((node) => ({
				x: Number.parseFloat(node.style.left),
				y: Number.parseFloat(node.style.top),
				w: Number.parseFloat(node.style.width),
				h: Number.parseFloat(node.style.height),
			}));
		const reportRect = (value) =>
			page.evaluate((rect) => {
				const probe = window.dragProbe;
				probe.setLayout({
					...probe.layout(),
					display: [
						rect.x * 2.4,
						rect.y * 2.4,
						(rect.x + rect.w) * 2.4,
						(rect.y + rect.h) * 2.4,
					],
				});
			}, value);
		const inspect = (name, expected, actual) => {
			const passed = ["x", "y", "w", "h"].every(
				(key) => Math.abs(expected[key] - actual[key]) < 0.01,
			);
			const result = { name, reducedMotion, expected, actual, passed };
			results.push(result);
			console.log(JSON.stringify(result));
			if (!passed) throw new Error(`Outline moved unexpectedly: ${name}`);
		};
		await box.waitFor();
		await page.keyboard.down("Shift");
		for (let index = 1; index <= 3; index++) {
			const bounds = await box.boundingBox();
			if (!bounds) throw new Error("Missing hit target");
			await page.mouse.move(
				bounds.x + bounds.width / 2,
				bounds.y + bounds.height / 2,
			);
			await page.mouse.down();
			await page.mouse.move(
				bounds.x + bounds.width / 2 + 31,
				bounds.y + bounds.height / 2 + 17,
				{ steps: 6 },
			);
			await page.mouse.up();
			const released = await read();
			await reportRect({ ...released, x: released.x - 23, y: released.y - 11 });
			inspect(`stale-frame-${index}`, released, await read());
			await reportRect(released);
			inspect(`final-frame-${index}`, released, await read());
		}
		await page.evaluate(() => {
			const probe = window.dragProbe;
			probe.setProject("background", "displayPosition", { x: 0.1, y: 0.5 });
			probe.setLayout({ ...probe.layout(), display: [-576, 108, 960, 972] });
			probe.setEditorState("canvasSelection", { type: "display" });
		});
		const handle = box.locator("[class*='cursor-se-resize']");
		const handleBounds = await handle.boundingBox();
		if (!handleBounds) throw new Error("Missing resize handle");
		await page.mouse.move(handleBounds.x + 3, handleBounds.y + 3);
		await page.mouse.down();
		await page.mouse.move(handleBounds.x - 27, handleBounds.y - 27, {
			steps: 6,
		});
		await page.mouse.up();
		const resized = await read();
		inspect(
			"edge-resize-center",
			{ ...resized, x: 80 - resized.w / 2, y: 225 - resized.h / 2 },
			resized,
		);
		await reportRect(resized);
		inspect("edge-resize-final-frame", resized, await read());
		await page.keyboard.up("Shift");
		await page.close();
	}
} finally {
	await writeFile(
		path.join(output, "results.json"),
		`${JSON.stringify(results, null, 2)}\n`,
	);
	console.log(`Evidence directory: ${output}`);
	await browser.close();
}
