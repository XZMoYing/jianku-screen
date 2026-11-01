import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const cap = path.resolve(directory, "../../cap");
const require = createRequire(path.join(cap, "apps/desktop/package.json"));
const { chromium } = require("playwright");
const code = await readFile("/private/tmp/jianku-u22c/fixture.js", "utf8");
const html = `<body><script>${code}</script></body>`;
await writeFile("/private/tmp/jianku-u22c/fixture.html", html);
const browser = await chromium.launch({
	headless: true,
	executablePath: process.env.JIANKU_BROWSER_PATH,
});
try {
	const results = [];
	for (const reducedMotion of ["no-preference", "reduce"]) {
		const page = await browser.newPage({ reducedMotion });
		await page.setContent(html);
		const result = await page.evaluate(() => window.__report);
		if (!result?.passed) throw new Error(JSON.stringify(result));
		results.push({ reducedMotion, ...result });
		await page.close();
	}
	await writeFile(
		path.join(directory, "browser-final.json"),
		`${JSON.stringify(results, null, 2)}\n`,
	);
	console.log(JSON.stringify(results));
} finally {
	await browser.close();
}
