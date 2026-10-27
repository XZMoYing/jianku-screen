import { spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const environment = {
	...process.env,
	CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? "2",
	PATH: [
		path.join(homedir(), ".cargo/bin"),
		path.join(homedir(), ".npm-global/bin"),
		process.env.PATH,
	].join(path.delimiter),
};
if (process.platform === "darwin") {
	environment.DEVELOPER_DIR ??= "/Applications/Xcode.app/Contents/Developer";
	environment.DYLD_LIBRARY_PATH = [
		path.join(root, "target/native-deps/lib"),
		path.join(root, "target/native-deps/onnxruntime/lib"),
		process.env.DYLD_LIBRARY_PATH,
	]
		.filter(Boolean)
		.join(path.delimiter);
}

const checks = [
	["cargo", ["fmt", "--all", "--", "--check"]],
	["cargo", ["check", "--locked", "--release", "-p", "cap-desktop"]],
	[
		"cargo",
		[
			"test",
			"--locked",
			"--release",
			"-p",
			"cap-project",
			"configuration_write_tests",
			"--",
			"--test-threads=1",
		],
	],
	[
		"cargo",
		[
			"test",
			"--locked",
			"--release",
			"-p",
			"cap-editor",
			"--lib",
			"telemetry::tests",
			"--",
			"--test-threads=1",
		],
	],
	[
		"bun",
		[
			"run",
			"--cwd",
			"apps/desktop",
			"vitest",
			"run",
			"src/routes/editor/project-config-save.test.ts",
			"src/routes/editor/editor-title-save-bridge.test.ts",
			"src/routes/editor/recording-title-save.test.ts",
			"src/utils/i18n.test.ts",
		],
	],
	["node", ["scripts/jianku.mjs", "frontend"]],
];

for (const [command, args] of checks) {
	console.log(`检查：${command} ${args.join(" ")}`);
	const code = await new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: root,
			env: environment,
			stdio: "inherit",
			shell: process.platform === "win32",
		});
		child.once("error", reject);
		child.once("exit", (exitCode) => resolve(exitCode ?? 1));
	});
	if (code !== 0) process.exit(code);
}
console.log("无人值守局部基线检查通过；不代表完整发布审计或实机验收通过。");
