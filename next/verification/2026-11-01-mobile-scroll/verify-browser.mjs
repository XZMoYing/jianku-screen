import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const cap = path.resolve(directory, "../../cap");
const require = createRequire(path.join(cap, "apps/desktop/package.json"));
const { build } = await import(require.resolve("vite"));
const solid = (await import(require.resolve("vite-plugin-solid"))).default;
const { chromium } = require("playwright");
const solidPath = path.dirname(require.resolve("solid-js/package.json"));
const output = await mkdtemp(path.join(tmpdir(), "jianku-mobile-scroll-"));
await build({
	configFile: false,
	root: directory,
	plugins: [solid()],
	resolve: {
		alias: [
			{
				find: /^(~icons\/.*|~\/utils\/tauri|~\/utils\/i18n|~\/components\/ChoiceSelect|@solid-primitives\/storage|@tauri-apps\/plugin-opener)$/,
				replacement: path.join(directory, "mobile-mocks.tsx"),
			},
			{ find: "~", replacement: path.join(cap, "apps/desktop/src") },
			{
				find: /^solid-js\/web$/,
				replacement: path.join(solidPath, "web/dist/web.js"),
			},
			{
				find: /^solid-js$/,
				replacement: path.join(solidPath, "dist/solid.js"),
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
const css = await readFile(
	path.join(cap, "apps/desktop/src/styles/workspace.css"),
	"utf8",
);
const html = `<style>${css}</style><style>.jk-motion-content,.jk-motion-panel{display:flex;flex:1;min-height:0;flex-direction:column}.jk-motion-panel[hidden]{display:none}</style><div id="root"></div><script>${code}</script>`;
await writeFile(path.join(output, "fixture.html"), html);
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
		const scroll = page.locator(".mobile-recorder");
		await scroll.waitFor({ state: "visible" });
		await page.waitForTimeout(300);
		await scroll.evaluate((node) => {
			node.scrollTop = 300;
		});
		const initial = await scroll.evaluate((node) => ({
			top: node.scrollTop,
			height: node.clientHeight,
			scrollHeight: node.scrollHeight,
		}));
		if (initial.top !== 300) throw new Error("Fixture must actually scroll");
		const inspect = async (name) => {
			const state = await scroll.evaluate((node) => ({
				top: node.scrollTop,
				height: node.clientHeight,
				scrollHeight: node.scrollHeight,
			}));
			const row = {
				name,
				reducedMotion,
				initial,
				state,
				passed: state.top === initial.top,
			};
			results.push(row);
			console.log(JSON.stringify(row));
			if (!row.passed) throw new Error(`Scroll position lost: ${name}`);
		};
		for (let index = 1; index <= 3; index++) {
			for (const [outgoing, incoming] of [
				["Presentation", "Recording"],
				["Desktop", "Mobile"],
			]) {
				await page.getByRole("button", { name: outgoing, exact: true }).click();
				await page.waitForTimeout(300);
				await page.getByRole("button", { name: incoming, exact: true }).click();
				await page.waitForTimeout(1000);
				await inspect(`${outgoing}-${incoming}-${index}`);
			}
		}
		await scroll.getByRole("button", { name: "刷新列表", exact: true }).click();
		await page.waitForTimeout(400);
		await inspect("explicit-history-refresh");
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
