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
const output = await mkdtemp(path.join(tmpdir(), "jianku-track-drag-"));
await build({
	configFile: false,
	root: directory,
	plugins: [icons({ compiler: "solid" }), solid()],
	resolve: {
		alias: [
			{
				find: /^\.\.\/context$/,
				replacement: path.join(directory, "context-mock.ts"),
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
const html = `<style>body{margin:0;padding:0}#root{width:1000px;height:44px}#root>div{position:relative;height:44px}[data-audio-segment],[data-text-segment],[data-mask-segment]{position:absolute;top:0;height:44px}.cap-track-fill{position:relative;height:100%;background:#dde5d5}.cursor-grab{position:relative;height:100%}.cursor-col-resize{position:absolute;top:0;height:100%;width:20px;z-index:10}.left-0{left:0}.right-0{right:0}.pointer-events-none{pointer-events:none}.absolute{position:absolute}</style><div id="root"></div><script>${code}</script>`;
await writeFile(path.join(output, "fixture.html"), html);
await writeFile(
	path.join(output, "webkit-fixture.html"),
	`${html}<script>try{window.__report=window.trackProbe.checks()}catch(error){window.__report={passed:false,error:String(error)}}</script>`,
);
const browser = await chromium.launch({
	headless: true,
	executablePath: process.env.JIANKU_BROWSER_PATH,
});
const results = [];
try {
	for (const reducedMotion of ["no-preference", "reduce"]) {
		const page = await browser.newPage({
			viewport: { width: 1100, height: 500 },
			reducedMotion,
		});
		await page.setContent(html);
		const report = await page.evaluate(() => window.trackProbe.checks());
		if (!report.passed) throw new Error(JSON.stringify(report));
		await page.evaluate(() => {
			const f = window.trackProbe.mount("audio");
			f.context.setEditorState("timeline", "selection", {
				type: "audio",
				indices: [0],
			});
			window.mouseFixture = f;
		});
		await page.mouse.move(200, 22);
		await page.mouse.down();
		await page.mouse.move(203, 22);
		await page.mouse.move(803, 22, { steps: 20 });
		await page.mouse.move(853, 22);
		await page.mouse.up();
		const pointer = await page.evaluate(() => {
			const f = window.mouseFixture;
			return {
				starts: Object.fromEntries(
					f.context.project.timeline.audioSegments.map((segment) => [
						segment.name,
						segment.start,
					]),
				),
				preservedNode:
					document.querySelector('[data-audio-segment][title="A"]') === f.node,
				counts: f.context.counts(),
				selection: f.context.editorState.timeline.selection,
			};
		});
		if (
			pointer.starts.A !== 15 ||
			pointer.starts.B !== 10 ||
			!pointer.preservedNode ||
			pointer.counts.resumes !== 1 ||
			pointer.selection.indices[0] !== 1
		)
			throw new Error(JSON.stringify(pointer));
		results.push({ reducedMotion, ...report, pointer });
		await page.close();
	}
	await writeFile(
		path.join(directory, "browser-final.json"),
		`${JSON.stringify(results, null, 2)}\n`,
	);
	console.log(JSON.stringify({ output, results }));
} finally {
	await browser.close();
}
