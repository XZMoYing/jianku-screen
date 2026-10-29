import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktop = path.join(root, "apps/desktop/src");
const dictionaries = Object.fromEntries(
	["zh-CN", "en"].map((language) => [
		language,
		JSON.parse(
			fs.readFileSync(path.join(desktop, `i18n/${language}.json`), "utf8"),
		),
	]),
);
const attributes = new Set([
	"label",
	"title",
	"placeholder",
	"description",
	"aria-label",
	"alt",
	"tooltip",
	"tooltipText",
	"hint",
	"content",
	"message",
]);
const sharedLabels = new Set(["Field", "Subfield", "Section", "SectionLabel"]);
const candidates = [];
const files = [];
const upstreamDestinations = [];
const moduleTranslations = [];

function walkFiles(directory) {
	return fs
		.readdirSync(directory, { withFileTypes: true })
		.flatMap((entry) => {
			const name = path.join(directory, entry.name);
			return entry.isDirectory() ? walkFiles(name) : [name];
		})
		.sort();
}

function family(file) {
	const relative = path.relative(desktop, file).replaceAll(path.sep, "/");
	if (!relative.startsWith("routes/")) return relative.split("/")[0];
	const parts = relative.slice(7).split("/");
	return parts[0] === "(window-chrome)" && parts.length > 1
		? parts[1].replace(/\.tsx?$/, "")
		: parts[0].replace(/\.tsx?$/, "");
}

function sourceLanguage(text) {
	if (/[\u3400-\u9fff]/u.test(text)) return "zh-CN";
	return /[A-Za-z]{2}/.test(text) ? "en" : "neutral";
}

function directlyRendered(node) {
	let current = node;
	while (current.parent) {
		const parent = current.parent;
		if (ts.isJsxExpression(parent))
			return parent.expression === current && !ts.isJsxAttribute(parent.parent);
		if (
			ts.isParenthesizedExpression(parent) ||
			(ts.isConditionalExpression(parent) && parent.condition !== current) ||
			(ts.isBinaryExpression(parent) &&
				[
					ts.SyntaxKind.BarBarToken,
					ts.SyntaxKind.AmpersandAmpersandToken,
					ts.SyntaxKind.QuestionQuestionToken,
				].includes(parent.operatorToken.kind))
		)
			current = parent;
		else return false;
	}
	return false;
}

function record(source, node, text, kind, mechanism, component) {
	if (kind === "jsx-expression") {
		let parent = node.parent;
		while (parent && !ts.isJsxElement(parent)) parent = parent.parent;
		if (parent) component = parent.openingElement.tagName.getText(source);
	}
	if (component === "style" || component === "script") return;
	if (kind === "jsx-text") text = text.replace(/\s+/g, " ").trim();
	if (!text || sourceLanguage(text) === "neutral") return;
	const line =
		source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
	const language = sourceLanguage(text);
	const target = language === "en" ? "zh-CN" : "en";
	const translation = dictionaries[target][text];
	candidates.push({
		file: path.relative(root, source.fileName).replaceAll(path.sep, "/"),
		line,
		family: family(source.fileName),
		kind,
		text,
		component: component ?? null,
		mechanism,
		sourceLanguage: language,
		targetLanguage: target,
		translation: typeof translation === "string" ? translation : null,
		status:
			mechanism === "explicit" || mechanism === "shared-label"
				? typeof translation === "string"
					? "dictionary-present"
					: "dictionary-review"
				: "callsite-review",
	});
}

for (const file of walkFiles(desktop)) {
	const relativeFile = path.relative(root, file).replaceAll(path.sep, "/");
	if (
		!/\.tsx?$/.test(relativeFile) ||
		/(?:\.test\.|\.spec\.|\.d\.ts$|\/utils\/tauri\.ts$)/.test(relativeFile)
	)
		continue;
	const text = fs.readFileSync(file, "utf8");
	const source = ts.createSourceFile(
		file,
		text,
		ts.ScriptTarget.Latest,
		true,
		file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	);
	const localizers = new Set();
	const shared = new Set();
	for (const statement of source.statements) {
		if (
			!ts.isImportDeclaration(statement) ||
			!ts.isStringLiteral(statement.moduleSpecifier)
		)
			continue;
		const moduleName = statement.moduleSpecifier.text;
		const bindings = statement.importClause?.namedBindings;
		if (!bindings || !ts.isNamedImports(bindings)) continue;
		for (const binding of bindings.elements) {
			const imported = binding.propertyName?.text ?? binding.name.text;
			if (moduleName.endsWith("/i18n") && imported === "t")
				localizers.add(binding.name.text);
			if (
				(moduleName === "./ui" || moduleName.endsWith("/editor/ui")) &&
				sharedLabels.has(imported)
			)
				shared.add(binding.name.text);
		}
	}
	files.push({
		file: path.relative(root, file).replaceAll(path.sep, "/"),
		family: family(file),
		bytes: Buffer.byteLength(text),
		sha256: createHash("sha256").update(text).digest("hex"),
	});
	function visit(node) {
		if (
			ts.isCallExpression(node) &&
			ts.isIdentifier(node.expression) &&
			localizers.has(node.expression.text)
		) {
			const argument = node.arguments[0];
			if (
				argument &&
				(ts.isStringLiteral(argument) ||
					ts.isNoSubstitutionTemplateLiteral(argument))
			) {
				record(source, argument, argument.text, "translation-call", "explicit");
				let scope = node.parent;
				while (scope && !ts.isFunctionLike(scope)) scope = scope.parent;
				if (!scope)
					moduleTranslations.push({
						file: path.relative(root, file),
						line:
							source.getLineAndCharacterOfPosition(node.getStart(source)).line +
							1,
						text: argument.text,
						status: "language-switch-timing-review",
					});
			}
		}
		if (ts.isJsxText(node))
			record(
				source,
				node,
				node.text,
				"jsx-text",
				"callsite-review",
				ts.isJsxElement(node.parent)
					? node.parent.openingElement.tagName.getText(source)
					: "fragment",
			);
		if (
			(ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
			directlyRendered(node)
		)
			record(source, node, node.text, "jsx-expression", "callsite-review");
		if (
			ts.isCallExpression(node) &&
			/^(?:toast\.(?:error|success|loading)|dialog\.(?:message|confirm))$/.test(
				node.expression.getText(source),
			)
		) {
			const message = node.arguments[0];
			if (message && ts.isStringLiteral(message))
				record(
					source,
					message,
					message.text,
					"notification",
					"callsite-review",
				);
		}
		if (ts.isJsxAttribute(node)) {
			const attribute = node.name.getText(source);
			const element = node.parent.parent;
			const component = element.tagName.getText(source);
			const sharedLabel = attribute === "name" && shared.has(component);
			const initializer = node.initializer;
			const value =
				initializer && ts.isJsxExpression(initializer)
					? initializer.expression
					: initializer;
			if (
				(attributes.has(attribute) || sharedLabel) &&
				value &&
				(ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value))
			)
				record(
					source,
					node,
					value.text,
					`attribute:${attribute}`,
					sharedLabel ? "shared-label" : "callsite-review",
					component,
				);
		}
		if (
			ts.isPropertyAssignment(node) &&
			(ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
			(attributes.has(node.name.text) || node.name.text === "name") &&
			ts.isStringLiteral(node.initializer)
		)
			record(
				source,
				node,
				node.initializer.text,
				`object:${node.name.text}`,
				"dataflow-review",
			);
		if (ts.isStringLiteral(node) && /^https?:\/\//.test(node.text)) {
			try {
				const url = new URL(node.text);
				if (
					url.hostname === "cap.so" ||
					url.hostname.endsWith(".cap.so") ||
					url.hostname === "cap.link"
				)
					upstreamDestinations.push({
						file: path.relative(root, file),
						line:
							source.getLineAndCharacterOfPosition(node.getStart(source)).line +
							1,
						destination: url.origin + url.pathname,
						status: "reachability-and-purpose-review",
					});
			} catch {}
		}
		ts.forEachChild(node, visit);
	}
	visit(source);
}

const placeholders = (text) =>
	[
		...new Set([...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1])),
	].sort();
const placeholderMismatches = [];
for (const [language, dictionary] of Object.entries(dictionaries)) {
	for (const [key, value] of Object.entries(dictionary)) {
		if (typeof value !== "string")
			throw new Error(`Non-string translation: ${language}/${key}`);
		if (
			JSON.stringify(placeholders(key)) !== JSON.stringify(placeholders(value))
		)
			placeholderMismatches.push({
				language,
				key,
				source: placeholders(key),
				translation: placeholders(value),
			});
	}
}
const byFamily = Object.fromEntries(
	[...new Set(files.map((file) => file.family))].sort().map((name) => {
		const rows = candidates.filter((candidate) => candidate.family === name);
		return [
			name,
			{
				files: files.filter((file) => file.family === name).length,
				candidates: rows.length,
				callsiteReview: rows.filter((row) => row.status === "callsite-review")
					.length,
				dictionaryReview: rows.filter(
					(row) => row.status === "dictionary-review",
				).length,
			},
		];
	}),
);
const report = {
	sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: root,
		encoding: "utf8",
	}).trim(),
	scope:
		"Desktop TS/TSX literal UI text, known shared labels, translation calls, label data, interpolation contracts and literal upstream destinations; candidates require semantic and runtime review.",
	limitations: [
		"Native menus/dialogs/errors need separate source review",
		"Only direct imported t aliases and audited Field/Section name props are recognized as localization mechanisms",
		"Dynamic expressions, computed labels, user content and route reachability are not proven",
		"Dictionary presence and shared-label recognition do not prove runtime rendering",
		"Proper nouns, technical formats, shortcuts and mandatory license attribution may intentionally remain unchanged",
	],
	dictionaryKeys: Object.fromEntries(
		Object.entries(dictionaries).map(([language, dictionary]) => [
			language,
			Object.keys(dictionary).length,
		]),
	),
	byFamily,
	files,
	candidates,
	placeholderMismatches,
	upstreamDestinations,
	moduleTranslations,
};
const outputIndex = process.argv.indexOf("--output");
if (outputIndex >= 0) {
	const output = process.argv[outputIndex + 1];
	if (!output || output.startsWith("--"))
		throw new Error("--output requires a new report path");
	fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, {
		flag: "wx",
	});
}
console.log(
	JSON.stringify(
		{
			files: files.length,
			candidates: candidates.length,
			dictionaryKeys: report.dictionaryKeys,
			placeholderMismatches: placeholderMismatches.length,
			upstreamDestinations: upstreamDestinations.length,
			byFamily,
		},
		null,
		2,
	),
);
