import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
	applyMotionTemplate,
	MOTION_TEMPLATES,
	normalizeCamera3DSegments,
	splitCamera3DMotion,
} from "../../cap/apps/desktop/src/routes/editor/three-d";
import type { ProjectConfiguration } from "../../cap/apps/desktop/src/utils/tauri";

const { values } = parseArgs({
	options: { source: { type: "string" }, directory: { type: "string" } },
});
if (!values.source || !values.directory)
	throw new Error("--source and --directory are required");
const source = resolve(values.source);
const output = resolve(values.directory);
if (existsSync(output))
	throw new Error("Use a new directory; existing fixtures are never replaced");
const cases = [
	...(
		[
			"flat",
			"static",
			"disabled",
			"motion",
			"combined",
			"static-focus",
			"motion-focus",
		] as const
	).map((name) => ({ name, base: name, expected: "identical" })),
	{ name: "natural-motion", base: "motion", expected: "different" },
	{ name: "natural-combined", base: "combined", expected: "different" },
	{ name: "natural-focus", base: "motion-focus", expected: "different" },
	{ name: "natural-sharp", base: "disabled", expected: "different" },
	{ name: "natural-split-sharp", base: "disabled", expected: "different" },
];
mkdirSync(output);
const template = MOTION_TEMPLATES.find((item) => item.id === "glide-across");
if (!template) throw new Error("The actual default look was not found");
for (const entry of cases) {
	const base = join(source, `${entry.base}.jks`);
	const marker = JSON.parse(
		readFileSync(join(base, ".jianku-3d-comfort.json"), "utf8"),
	);
	if (marker.kind !== "jianku-3d-comfort")
		throw new Error("Only synthetic U18a fixtures are accepted");
	const project = join(output, `${entry.name}.jks`);
	cpSync(base, project, { recursive: true });
	if (entry.name.startsWith("natural-")) {
		const path = join(project, "project-config.json");
		const config = JSON.parse(
			readFileSync(path, "utf8"),
		) as ProjectConfiguration;
		if (!config.timeline) throw new Error("Fixture has no timeline");
		const [segment] = normalizeCamera3DSegments(
			config.timeline.camera3dSegments,
		);
		applyMotionTemplate(segment, template);
		if (entry.name !== "natural-focus")
			segment.blur = { ...segment.blur, mode: "none", strength: 0 };
		config.timeline.camera3dSegments =
			entry.name === "natural-split-sharp"
				? splitCamera3DMotion(segment, 3.25)
				: [segment];
		writeFileSync(path, `${JSON.stringify(config, null, "\t")}\n`);
	}
	writeFileSync(
		join(project, ".jianku-3d-spring-fixture.json"),
		`${JSON.stringify({ kind: "jianku-3d-spring", version: 1 })}\n`,
	);
}
writeFileSync(
	join(output, "cases.json"),
	`${JSON.stringify(cases, null, "\t")}\n`,
);
console.log(output);
