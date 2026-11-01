import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const cap = process.cwd();
const require = createRequire(path.join(cap, "apps/desktop/package.json"));
const source = await readFile(
	"apps/desktop/src/routes/editor/Timeline/TextTrack.tsx",
	"utf8",
);
const start = source.indexOf("\t\t\tcreateRoot((dispose) => {");
const end = source.indexOf("\n\t\t\t});", start) + "\n\t\t\t});".length;
if (start < 0 || end <= start) throw new Error("Missing original drag root");
const block = source.slice(start, end);
await writeFile("/private/tmp/jianku-u22c2/original-root.txt", block);
const fixture = `import {createRoot} from "solid-js";import {createEventListenerMap} from "@solid-primitives/event-listener";
const cases=[];for(const kind of ["blur","owner-disposal"]){let updates=0,finishes=0;let release;const handleUpdate=()=>updates++;const finish=()=>finishes++;createRoot(owner=>{release=owner;${block}});if(kind==="blur")window.dispatchEvent(new Event("blur"));else release();window.dispatchEvent(new MouseEvent("mousemove",{buttons:1}));cases.push({kind,updatesAfterCancellation:updates,finishCallsAfterCancellation:finishes});window.dispatchEvent(new MouseEvent("mouseup"));release();}Object.assign(window,{__report:{cases,observed:cases.every(row=>row.updatesAfterCancellation===1&&row.finishCallsAfterCancellation===0)}});`;
await writeFile("/private/tmp/jianku-u22c2/fixture.js", fixture);
const { build } = await import(require.resolve("vite"));
const solid = path.dirname(require.resolve("solid-js/package.json"));
await build({
	configFile: false,
	root: cap,
	resolve: {
		alias: [
			{ find: /^solid-js$/, replacement: path.join(solid, "dist/solid.js") },
			{
				find: /^solid-js\/web$/,
				replacement: path.join(solid, "web/dist/web.js"),
			},
			{
				find: /^@solid-primitives\/event-listener$/,
				replacement: path.join(
					cap,
					"node_modules/@solid-primitives/event-listener/dist/index.js",
				),
			},
		],
	},
	build: {
		lib: {
			entry: "/private/tmp/jianku-u22c2/fixture.js",
			name: "Probe",
			formats: ["iife"],
			fileName: () => "bundle.js",
		},
		outDir: "/private/tmp/jianku-u22c2/built",
		emptyOutDir: false,
	},
});
const code = await readFile(
	"/private/tmp/jianku-u22c2/built/bundle.js",
	"utf8",
);
const { chromium } = require("playwright");
const browser = await chromium.launch({
	headless: true,
	executablePath:
		"/Users/moyingxz/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell",
});
try {
	const page = await browser.newPage();
	await page.setContent(`<script>${code}</script>`);
	const result = await page.evaluate(() => window.__report);
	if (!result?.observed) throw new Error(JSON.stringify(result));
	await writeFile(
		"/private/tmp/jianku-u22c2/result.json",
		`${JSON.stringify(
			{
				sourceSha256: createHash("sha256").update(source).digest("hex"),
				scope:
					"original TextTrack listener root with simulated update/finish callbacks; real Solid ownership/event-listener library and Chromium",
				...result,
			},
			null,
			2,
		)}\n`,
	);
	console.log(JSON.stringify(result));
} finally {
	await browser.close();
}
