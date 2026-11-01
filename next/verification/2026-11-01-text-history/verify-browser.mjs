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
const output = await mkdtemp(path.join(tmpdir(), "jianku-text-history-"));
await build({
	configFile: false,
	root: directory,
	plugins: [
		{
			name: "history-context",
			enforce: "pre",
			resolveId(id, importer) {
				if (!importer || !id.startsWith(".")) return;
				const target = path
					.resolve(path.dirname(importer), id)
					.replace(/\.tsx?$/, "");
				const editor = path.join(cap, "apps/desktop/src/routes/editor");
				if (target === path.join(editor, "context"))
					return path.join(directory, "context-mock.ts");
				if (target === path.join(editor, "CanvasElementsOverlay"))
					return path.join(directory, "canvas-mock.ts");
			},
		},
		icons({ compiler: "solid" }),
		solid(),
	],
	resolve: {
		alias: [
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
const html = `<div id="root"></div><script>${code}</script>`;
await writeFile(path.join(output, "fixture.html"), html);
await writeFile(
	path.join(output, "webkit-fixture.html"),
	`${html}<script>window.historyProbe.check().then(result=>window.__report=result).catch(error=>window.__report={passed:false,error:String(error)})</script>`,
);
const browser = await chromium.launch({
	headless: true,
	executablePath: process.env.JIANKU_BROWSER_PATH,
});
const results = [];
try {
	for (const reducedMotion of ["no-preference", "reduce"]) {
		const page = await browser.newPage({ reducedMotion });
		await page.setContent(html);
		const result = await page.evaluate(() => window.historyProbe.check());
		if (!result.passed) throw new Error(JSON.stringify(result));
		results.push({ reducedMotion, ...result });
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
