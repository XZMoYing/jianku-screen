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
const output = await mkdtemp(path.join(tmpdir(), "jianku-overlay-drag-"));
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
const html = `<style>body{margin:0;padding:0}#root{width:1000px;height:44px}#root>div{position:relative;height:44px}[data-overlay-segment]{position:absolute;top:0;height:44px}.cap-track-fill{position:relative;height:100%;background:#dde5d5}.cursor-grab{position:relative;height:100%}.cursor-col-resize{position:absolute;top:0;height:100%;width:20px;z-index:10}.left-0{left:0}.right-0{right:0}.pointer-events-none{pointer-events:none}.absolute{position:absolute}</style><div id="root"></div><script>${code}</script>`;
await writeFile(path.join(output, "fixture.html"), html);
await writeFile(
	path.join(output, "webkit-fixture.html"),
	`${html}<script>try{window.__report=window.overlayProbe.checks()}catch(error){window.__report={passed:false,error:String(error)}}</script>`,
);
const browser = await chromium.launch({
	headless: true,
	executablePath:
		process.env.JIANKU_BROWSER_PATH ??
		"/Users/moyingxz/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell",
});
const results = [];
try {
	for (const reducedMotion of ["no-preference", "reduce"]) {
		const page = await browser.newPage({
			viewport: { width: 1100, height: 500 },
			reducedMotion,
		});
		await page.setContent(html);
		const report = await page.evaluate(() => window.overlayProbe.checks());
		if (!report.passed) throw new Error(JSON.stringify(report));
		const pointers = [];
		for (const kind of ["style", "image"]) {
			await page.evaluate((type) => {
				const f = window.overlayProbe.mount(type);
				f.beforeMotion = window.overlayProbe.signature(f.context.items()[1]);
				window.pointerFixture = f;
			}, kind);
			await page.waitForFunction(() => {
				const rect = window.pointerFixture.node.getBoundingClientRect();
				return Math.abs(rect.left - 200) < 1 && Math.abs(rect.width - 400) < 1;
			});
			await page.mouse.move(300, 22);
			await page.mouse.down();
			await page.mouse.move(500, 22, { steps: 12 });
			await page.mouse.up();
			const pointer = await page.evaluate(() => {
				const f = window.pointerFixture;
				const items = f.context.items();
				return {
					start: items[1].start,
					end: items[1].end,
					hiddenStart: items[0].start,
					otherStart: items[2].start,
					preservedNode:
						document.querySelector("[data-overlay-segment]") === f.node,
					preservedMotion:
						window.overlayProbe.signature(items[1]) === f.beforeMotion,
					resumes: f.context.counts().resumes,
				};
			});
			if (
				Math.abs(pointer.start - 4) > 1e-8 ||
				Math.abs(pointer.end - 8) > 1e-8 ||
				pointer.hiddenStart !== 20 ||
				pointer.otherStart !== 10 ||
				!pointer.preservedNode ||
				!pointer.preservedMotion ||
				pointer.resumes !== 1
			)
				throw new Error(JSON.stringify(pointer));
			pointers.push({ kind, ...pointer });
		}
		results.push({ reducedMotion, ...report, pointers });
		await page.close();
	}
	await writeFile(
		path.join(directory, "browser-final.json"),
		`${JSON.stringify(results, null, 2)}\n`,
	);
	console.log(
		JSON.stringify({
			output,
			cases: results.map((row) => ({
				reducedMotion: row.reducedMotion,
				checks: row.observations.length,
				pointers: row.pointers,
				passed: row.passed,
			})),
		}),
	);
} finally {
	await browser.close();
}
