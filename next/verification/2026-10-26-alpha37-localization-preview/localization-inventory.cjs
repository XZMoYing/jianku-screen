const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(process.argv[2] || process.cwd());
const parser = require(path.join(root, "node_modules/@babel/parser"));
const candidates = [];
const errors = [];
let files = 0;
const attributes = new Set([
	"title",
	"aria-label",
	"placeholder",
	"label",
	"name",
	"alt",
]);
const technical =
	/^(?:3D|FPS|CPU|GPU|HDR|SDR|NV12|RGBA|AAC|H[.]?264|H[.]?265|MP4|MOV|WEBM|PNG|JPEG|GIF|SRT|VTT|JSON|USB|iOS|iPad|Android|macOS|Windows|Linux|MB|GB|MiB|GiB|KB|Hz|dB|px|ms|HTML|SVG)$/i;
function eligible(text) {
	return (
		/[a-z]{3}/i.test(text) &&
		!technical.test(text.trim()) &&
		!/^[\d\W]+$/.test(text)
	);
}
function add(file, node, kind, value) {
	const text = value.replace(/\s+/g, " ").trim();
	if (text && eligible(text))
		candidates.push({
			file: path.relative(root, file),
			line: node.loc.start.line,
			kind,
			text,
		});
}
function walk(node, file) {
	if (!node || typeof node !== "object") return;
	if (node.type === "JSXText") add(file, node, "direct JSX text", node.value);
	if (
		node.type === "JSXAttribute" &&
		attributes.has(node.name.name) &&
		node.value
	) {
		if (node.value.type === "StringLiteral")
			add(file, node, "literal attribute", node.value.value);
		else if (node.value.type === "JSXExpressionContainer") {
			const expression = node.value.expression;
			if (expression.type === "StringLiteral")
				add(file, node, "expression attribute", expression.value);
			if (expression.type === "TemplateLiteral")
				add(
					file,
					node,
					"template attribute",
					expression.quasis.map((part) => part.value.cooked).join("{…}"),
				);
		}
	}
	for (const value of Object.values(node)) {
		if (Array.isArray(value)) {
			for (const child of value)
				if (child && typeof child.type === "string") walk(child, file);
		} else if (value && typeof value.type === "string") {
			walk(value, file);
		}
	}
}
function scan(directory) {
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const file = path.join(directory, entry.name);
		if (entry.isDirectory()) scan(file);
		else if (
			/\.tsx$/.test(entry.name) &&
			!/\.(?:test|spec)\./.test(entry.name)
		) {
			files++;
			try {
				walk(
					parser.parse(fs.readFileSync(file, "utf8"), {
						sourceType: "module",
						plugins: ["typescript", "jsx"],
					}),
					file,
				);
			} catch (error) {
				errors.push({ file: path.relative(root, file), error: String(error) });
			}
		}
	}
}
scan(path.join(root, "apps/desktop/src/routes"));
scan(path.join(root, "apps/desktop/src/components"));
const output = {
	scope:
		"Static TSX candidate inventory only; not full localization coverage, no user strings or internal identifiers modified. Dynamic conditional/translation calls, native menus and CLI require separate review.",
	filesScanned: files,
	candidateCount: candidates.length,
	parseErrors: errors,
	candidates,
};
const target = path.resolve(process.argv[3] || "localization-candidates.json");
fs.writeFileSync(target, `${JSON.stringify(output, null, "\t")}\n`);
process.stdout.write(
	`${JSON.stringify({
		files,
		candidates: candidates.length,
		errors: errors.length,
		sample: candidates.slice(0, 5),
	})}\n`,
);
