import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const cap = process.cwd();
const require = createRequire(path.join(cap, "apps/desktop/package.json"));
const source = await readFile(
	"apps/desktop/src/routes/editor/Timeline/ThreeDTrack.tsx",
	"utf8",
);
const area = "/private/tmp/jianku-three-d-diagnosis-20261102";
await mkdir(area, { recursive: true });
const handler = source.indexOf("function createMouseDownDrag<T>");
const rootStart = source.indexOf("createRoot((dispose) => {", handler);
const start = source.lastIndexOf("\n", rootStart) + 1;
const indent = source.slice(start, rootStart);
const closing = `\n${indent}});`;
const end = source.indexOf(closing, rootStart) + closing.length;
if (handler < 0 || rootStart < 0 || end <= start)
	throw new Error("Missing original 3D drag root");
const updateStart = source.indexOf(
	"function update(event: MouseEvent)",
	handler,
);
if (updateStart < 0 || updateStart > start)
	throw new Error("Missing original 3D updater");
const updater = source
	.slice(updateStart, start)
	.replace("event: MouseEvent", "event")
	.trim();
await writeFile(
	`${area}/original-update.txt`,
	source.slice(updateStart, start),
);
const block = source.slice(start, end);
await writeFile(
	"/private/tmp/jianku-three-d-diagnosis-20261102/original-root.txt",
	block,
);
const fixture = `import {createRoot} from "solid-js";import {createEventListenerMap} from "@solid-primitives/event-listener";
const cases=[];for(const kind of ["blur","owner-disposal"]){let updates=0,finishes=0;let release;const update=()=>updates++;const finish=()=>finishes++;createRoot(owner=>{release=owner;${block}});if(kind==="blur")window.dispatchEvent(new Event("blur"));else release();window.dispatchEvent(new MouseEvent("mousemove",{buttons:1}));cases.push({kind,updatesAfterCancellation:updates,finishCallsAfterCancellation:finishes});window.dispatchEvent(new MouseEvent("mouseup"));release();}let moved=false,initialMouseX=null,capturedDelta=null;const downEvent={clientX:200},initial={},props={onDragStateChanged:()=>{}};const _update=(event,value,origin)=>{capturedDelta=event.clientX-origin};${updater};update(new MouseEvent("mousemove",{clientX:600,buttons:1}));const coalescedMove={expectedPointerDistance:400,actualAppliedDistance:capturedDelta};Object.assign(window,{__report:{cases,coalescedMove,observed:cases.every(row=>row.updatesAfterCancellation===1&&row.finishCallsAfterCancellation===0)&&capturedDelta===0}});`;
await writeFile(
	"/private/tmp/jianku-three-d-diagnosis-20261102/fixture.js",
	fixture,
);
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
			entry: "/private/tmp/jianku-three-d-diagnosis-20261102/fixture.js",
			name: "Probe",
			formats: ["iife"],
			fileName: () => "bundle.js",
		},
		outDir: "/private/tmp/jianku-three-d-diagnosis-20261102/built",
		emptyOutDir: false,
	},
});
const code = await readFile(
	"/private/tmp/jianku-three-d-diagnosis-20261102/built/bundle.js",
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
		"/private/tmp/jianku-three-d-diagnosis-20261102/result.json",
		`${JSON.stringify(
			{
				sourceSha256: createHash("sha256").update(source).digest("hex"),
				scope:
					"original ThreeDTrack listener root/updater with counted update/finish/geometry callbacks; real Solid ownership/event-listener library and Chromium; not the complete component",
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
