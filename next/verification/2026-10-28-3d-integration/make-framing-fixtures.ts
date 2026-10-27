import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
	ANGLE_PRESETS,
	anglePresetMotion,
	applyMotionTemplate,
	defaultCamera3DSegment,
} from "../../cap/apps/desktop/src/routes/editor/three-d";
import type { ProjectConfiguration } from "../../cap/apps/desktop/src/utils/tauri";

const { values } = parseArgs({
	options: { source: { type: "string" }, directory: { type: "string" } },
});
if (!values.source || !values.directory)
	throw new Error("--source and --directory are required");
for (const name of ["perspective", "center"]) {
	const output = join(values.directory, `${name}.jks`);
	if (existsSync(output)) throw new Error("Use fresh output paths");
	cpSync(values.source, output, { recursive: true });
	const path = join(output, "project-config.json");
	const config = JSON.parse(readFileSync(path, "utf8")) as ProjectConfiguration;
	if (!config.timeline) throw new Error("Missing timeline");
	const preset = ANGLE_PRESETS.find((item) => item.id === name);
	if (!preset) throw new Error("Missing preset");
	const segment = defaultCamera3DSegment(1, 5);
	applyMotionTemplate(segment, anglePresetMotion(preset));
	config.timeline.camera3dSegments = [segment];
	writeFileSync(path, JSON.stringify(config, null, "\t"));
	writeFileSync(
		join(output, ".jianku-3d-integration-fixture.json"),
		JSON.stringify({ kind: "jianku-3d-integration", version: 1 }),
	);
}
