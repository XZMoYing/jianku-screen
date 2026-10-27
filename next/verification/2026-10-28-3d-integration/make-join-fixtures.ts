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
	normalizeCamera3DSegments,
	splitCamera3DMotion,
} from "../../cap/apps/desktop/src/routes/editor/three-d";
import type { ProjectConfiguration } from "../../cap/apps/desktop/src/utils/tauri";

const { values } = parseArgs({
	options: { source: { type: "string" }, directory: { type: "string" } },
});
if (!values.source || !values.directory)
	throw new Error("--source and --directory are required");
const output = resolve(values.directory);
if (existsSync(output)) throw new Error("Use a fresh fixture directory");
const source = resolve(values.source);
const marker = JSON.parse(
	readFileSync(join(source, ".jianku-3d-spring-fixture.json"), "utf8"),
);
if (marker.kind !== "jianku-3d-spring")
	throw new Error("Only the synthetic U18b source is accepted");
mkdirSync(output);
for (const name of ["whole", "aligned", "offgrid", "hardcut"]) {
	const project = join(output, `${name}.jks`);
	cpSync(source, project, { recursive: true });
	const path = join(project, "project-config.json");
	const config = JSON.parse(readFileSync(path, "utf8")) as ProjectConfiguration;
	if (!config.timeline) throw new Error("Missing timeline");
	const [segment] = normalizeCamera3DSegments(config.timeline.camera3dSegments);
	const pieces =
		name === "whole"
			? [segment]
			: splitCamera3DMotion(segment, name === "aligned" ? 3.25 : 3.259);
	if (name === "hardcut") {
		pieces[1].properties.panX += 0.2;
		for (const key of pieces[1].tracks.panX) key.value += 0.2;
	}
	config.timeline.camera3dSegments = pieces;
	writeFileSync(path, `${JSON.stringify(config, null, "\t")}\n`);
	writeFileSync(
		join(project, ".jianku-3d-integration-fixture.json"),
		JSON.stringify({ kind: "jianku-3d-integration", version: 1 }),
	);
}
console.log(output);
