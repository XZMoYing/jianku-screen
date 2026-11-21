import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const capRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const repoRoot = path.resolve(capRoot, "../..");
const desktopSrc = path.join(capRoot, "apps/desktop/src");
const stylesDir = path.join(desktopSrc, "styles");

function walkFiles(directory) {
	const results = [];
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const fullPath = path.join(directory, entry.name);
		if (entry.isDirectory()) results.push(...walkFiles(fullPath));
		else results.push(fullPath);
	}
	return results.sort();
}

function extractTopLevelSelectors(css) {
	const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
	const selectors = new Set();
	let pos = 0;
	while (pos < stripped.length) {
		while (pos < stripped.length && /\s/.test(stripped[pos])) pos += 1;
		if (pos >= stripped.length) break;
		const brace = stripped.indexOf("{", pos);
		if (brace === -1) break;
		const header = stripped.slice(pos, brace).replace(/\s+/g, " ").trim();
		let depth = 1;
		let index = brace + 1;
		while (index < stripped.length && depth > 0) {
			if (stripped[index] === "{") depth += 1;
			else if (stripped[index] === "}") depth -= 1;
			index += 1;
		}
		if (!header.startsWith("@")) {
			for (const part of header.split(",")) {
				const normalized = part.trim().replace(/^:root\s+/, "");
				if (normalized) selectors.add(normalized);
			}
		}
		pos = index;
	}
	return selectors;
}

test("desktop src has no zero-byte placeholder files", () => {
	const emptyFiles = walkFiles(desktopSrc)
		.filter((file) => fs.statSync(file).size === 0)
		.map((file) => path.relative(capRoot, file));
	assert.deepEqual(emptyFiles, []);
});

test("desktop styles use a three-layer stack without duplicate top-level selectors", () => {
	const appSource = fs.readFileSync(path.join(desktopSrc, "app.tsx"), "utf8");
	const imports = [
		...appSource.matchAll(/import\s+"\.\/styles\/([^"]+)";/g),
	].map((match) => match[1]);
	assert.deepEqual(imports, ["theme.css", "expressive.css", "workspace.css"]);

	const expressive = extractTopLevelSelectors(
		fs.readFileSync(path.join(stylesDir, "expressive.css"), "utf8"),
	);
	const workspace = extractTopLevelSelectors(
		fs.readFileSync(path.join(stylesDir, "workspace.css"), "utf8"),
	);
	const overlap = [...expressive]
		.filter((selector) => workspace.has(selector))
		.sort();
	assert.deepEqual(overlap, []);
});

test("desktop styles define every referenced --studio-* variable and avoid legacy purple hexes", () => {
	const cssFiles = walkFiles(stylesDir).filter((file) => file.endsWith(".css"));
	const definedStudioVars = new Set();
	const usedStudioVars = new Set();
	for (const file of cssFiles) {
		const content = fs.readFileSync(file, "utf8");
		for (const match of content.matchAll(/(--studio-[a-z0-9-]+)\s*:/g))
			definedStudioVars.add(match[1]);
		for (const match of content.matchAll(/var\((--studio-[a-z0-9-]+)/g))
			usedStudioVars.add(match[1]);
	}
	const undefinedVars = [...usedStudioVars]
		.filter((name) => !definedStudioVars.has(name))
		.sort();
	assert.deepEqual(undefinedVars, []);

	const legacyPurple = [
		"#7063e8",
		"#6254da",
		"#7962d1",
		"#7660cb",
		"#b8a8ed",
		"#f3efff",
		"#f0ecfb",
		"#f5f2fc",
		"#eeeaf6",
	];
	const checkedFiles = [
		...cssFiles,
		path.join(desktopSrc, "routes/presentation-output.tsx"),
	];
	const hits = [];
	for (const file of checkedFiles) {
		const lower = fs.readFileSync(file, "utf8").toLowerCase();
		for (const color of legacyPurple) {
			if (lower.includes(color))
				hits.push(`${path.relative(capRoot, file)}:${color}`);
		}
	}
	assert.deepEqual(hits, []);
});

test("active repository markdown entrypoints have no broken relative links", () => {
	const activeDocs = [
		path.join(repoRoot, "README.md"),
		path.join(repoRoot, "next/README.md"),
		path.join(repoRoot, "research/README.md"),
		path.join(repoRoot, "docs/archive/README.md"),
		...fs
			.readdirSync(path.join(repoRoot, "docs"))
			.filter((name) => name.endsWith(".md"))
			.map((name) => path.join(repoRoot, "docs", name)),
	];
	const broken = [];
	for (const file of activeDocs) {
		const content = fs.readFileSync(file, "utf8");
		const baseDir = path.dirname(file);
		for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
			const target = match[1].split("#")[0].trim();
			if (
				!target ||
				target.startsWith("http://") ||
				target.startsWith("https://") ||
				target.startsWith("mailto:")
			) {
				continue;
			}
			const resolved = path.resolve(baseDir, target);
			if (!fs.existsSync(resolved)) {
				broken.push(`${path.relative(repoRoot, file)} -> ${target}`);
			}
		}
	}
	assert.deepEqual(broken, []);
});
