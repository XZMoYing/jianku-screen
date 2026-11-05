import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
	jiankuBuildConfiguration,
	mergeTauriConfig,
} from "./jianku-config.mjs";

const base = JSON.parse(
	readFileSync(
		new URL("../apps/desktop/src-tauri/tauri.conf.json", import.meta.url),
		"utf8",
	),
);
const commonSidecars = [
	"binaries/cap-muxer",
	"binaries/cap-exporter",
	"binaries/cap-cli",
];

test("Windows and Linux packaging only requests the sidecars their build creates", () => {
	for (const [platform, bundle] of [
		["win32", "nsis"],
		["linux", "deb"],
	]) {
		const plan = jiankuBuildConfiguration(platform);
		assert.equal(plan.bundle, bundle);
		assert.deepEqual(plan.config.bundle.externalBin, commonSidecars);
		assert.equal(
			Object.keys(plan.config.bundle.resources).some((key) =>
				key.includes("jianku-scrcpy"),
			),
			false,
		);
	}
});

test("Mac keeps mobile capture and every platform keeps project identity and built-in assets", () => {
	const mac = jiankuBuildConfiguration("darwin");
	assert.equal(mac.bundle, "app");
	assert.deepEqual(mac.config.bundle.externalBin, [
		...commonSidecars,
		"binaries/jianku-device-capture",
		"binaries/jianku-android-capture",
	]);
	assert.equal(
		mac.config.bundle.resources[
			"../../../target/native-deps/jianku-scrcpy/scrcpy-server-v4.1"
		],
		"mobile/scrcpy-server",
	);
	assert.ok(
		mac.config.bundle.macOS.frameworks.some((file) =>
			file.endsWith("libSDL3.0.dylib"),
		),
	);
	for (const platform of ["darwin", "win32", "linux"]) {
		const config = mergeTauriConfig(
			base,
			jiankuBuildConfiguration(platform).config,
		);
		assert.equal(config.identifier, "com.jianku.screen.next");
		assert.deepEqual(config.bundle.fileAssociations[0].ext, ["jks"]);
		for (const [source, destination] of Object.entries(base.bundle.resources))
			assert.equal(config.bundle.resources[source], destination);
		assert.equal(
			config.bundle.resources["../../../JIANKU-NOTICE.md"],
			"licenses/JIANKU-NOTICE.md",
		);
	}
});

test("Tauri-style overlays replace arrays and remove null fields without mutating the base", () => {
	const original = {
		bundle: { externalBin: commonSidecars, resources: { keep: "a", old: "b" } },
	};
	const result = mergeTauriConfig(original, {
		bundle: {
			externalBin: ["replacement"],
			resources: { old: null, add: "c" },
		},
	});
	assert.deepEqual(result.bundle.externalBin, ["replacement"]);
	assert.deepEqual(result.bundle.resources, { keep: "a", add: "c" });
	assert.deepEqual(original.bundle.externalBin, commonSidecars);
	assert.equal(original.bundle.resources.old, "b");
});
