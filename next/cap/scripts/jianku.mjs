import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktop = path.join(root, "apps/desktop");
const profile = process.argv[2] === "release" ? "release" : "debug";
const environment = {
	...process.env,
	PATH: [path.join(homedir(), ".cargo/bin"), process.env.PATH].join(
		path.delimiter,
	),
	VITE_SERVER_URL: "http://127.0.0.1:9",
	CAP_GPUI_DEV: "0",
};

for (const key of [
	"VITE_OPENPANEL_CLIENT_ID",
	"VITE_OPENPANEL_API_URL",
	"CAP_DESKTOP_SENTRY_URL",
]) {
	delete environment[key];
}

function run(command, args, cwd = root, timeout) {
	const result = spawnSync(command, args, {
		cwd,
		env: environment,
		stdio: "inherit",
		timeout,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}

function checkNativeTools() {
	if (process.platform !== "darwin") return;
	if (!environment.DEVELOPER_DIR) {
		for (const name of ["Xcode.app", "Xcode_16.2.app", "Xcode-16.2.app"]) {
			const developer = path.join("/Applications", name, "Contents/Developer");
			if (existsSync(path.join(developer, "usr/bin/xcodebuild"))) {
				environment.DEVELOPER_DIR = developer;
				break;
			}
		}
	}
	const result = spawnSync("xcodebuild", ["-version"], {
		env: environment,
		encoding: "utf8",
	});
	if (result.status !== 0) {
		console.error(
			"原生构建需要完整 Xcode。macOS 14.7 可安装 Xcode 16.2；安装后可使用 DEVELOPER_DIR 指定其 Contents/Developer 目录。苹果下载需要本人登录 Apple 账户。已有 Qt 版本不受影响。",
		);
		process.exit(2);
	}
}

function prepareEnvironment() {
	const envPath = path.join(root, ".env");
	if (!existsSync(envPath)) {
		writeFileSync(
			envPath,
			"NODE_ENV=development\nVITE_SERVER_URL=http://127.0.0.1:9\nRUST_BACKTRACE=1\nCAP_GPUI_DEV=0\n",
		);
	}
}

function buildSidecars() {
	run("cargo", [
		"build",
		"--locked",
		"-p",
		"cap-muxer",
		"-p",
		"cap",
		...(profile === "release" ? ["--release"] : []),
	]);
	const host = spawnSync("rustc", ["-vV"], {
		env: environment,
		encoding: "utf8",
	});
	if (host.status !== 0) throw new Error("无法读取 Rust 主机目标");
	const triple = host.stdout.match(/^host:\s*(.+)$/m)?.[1]?.trim();
	if (!triple) throw new Error("Rust 主机目标缺失");
	const extension = process.platform === "win32" ? ".exe" : "";
	const binaries = path.join(desktop, "src-tauri/binaries");
	mkdirSync(binaries, { recursive: true });
	for (const [source, target] of [
		["cap-muxer", "cap-muxer"],
		["cap", "cap-cli"],
		["cap", "cap-exporter"],
	]) {
		copyFileSync(
			path.join(root, "target", profile, source + extension),
			path.join(binaries, `${target}-${triple}${extension}`),
		);
	}
	run("node", ["scripts/prepare.js"], desktop);
}

function removeSigningTemps(directory) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const target = path.join(directory, entry.name);
		if (entry.isDirectory()) removeSigningTemps(target);
		else if (entry.name.endsWith(".cstemp")) unlinkSync(target);
	}
}

function nestedFrameworks(directory) {
	const frameworks = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const target = path.join(directory, entry.name);
		frameworks.push(...nestedFrameworks(target));
		if (entry.name.endsWith(".framework")) frameworks.push(target);
	}
	return frameworks;
}

function signMacBundle() {
	if (process.platform !== "darwin") return;
	const available = spawnSync(
		"security",
		["find-identity", "-v", "-p", "codesigning"],
		{
			env: environment,
			encoding: "utf8",
		},
	);
	const identity =
		environment.APPLE_SIGNING_IDENTITY ??
		(available.status === 0 && available.stdout.includes('"JiankuDev"')
			? "JiankuDev"
			: "-");
	const localKeychain = path.join(
		homedir(),
		"Library/Keychains/jianku-dev.keychain-db",
	);
	const keychain =
		environment.JIANKU_SIGNING_KEYCHAIN ??
		(identity === "JiankuDev" && existsSync(localKeychain)
			? localKeychain
			: undefined);
	const app = path.join(
		root,
		"target",
		profile,
		"bundle/macos/Jianku Screen Next.app",
	);
	// Sign framework containers explicitly: Tauri signs their dylibs, but not every container.
	removeSigningTemps(app);
	for (const framework of nestedFrameworks(app)) {
		run(
			"codesign",
			[
				"--force",
				"--sign",
				identity,
				...(keychain ? ["--keychain", keychain] : []),
				framework,
			],
			root,
			60_000,
		);
	}
	run(
		"codesign",
		[
			"--force",
			"--sign",
			identity,
			...(keychain ? ["--keychain", keychain] : []),
			"--identifier",
			"com.jianku.screen.next",
			"--entitlements",
			path.join(desktop, "src-tauri/Entitlements.plist"),
			app,
		],
		root,
		60_000,
	);
	run("codesign", ["--verify", "--deep", "--strict", app]);
}

function main() {
	const command = process.argv[2];
	if (!["setup", "frontend", "check", "build", "release"].includes(command)) {
		throw new Error(
			"用法：node scripts/jianku.mjs setup|frontend|check|build|release",
		);
	}
	prepareEnvironment();
	if (command === "setup") {
		run("bun", ["install", "--frozen-lockfile"]);
		run("node", ["scripts/setup.js"]);
	} else if (command === "frontend") {
		run("bun", ["run", "build"], desktop);
	} else {
		checkNativeTools();
		if (command === "check") {
			environment.TAURI_CONFIG = readFileSync(
				path.join(desktop, "src-tauri/tauri.jianku.conf.json"),
				"utf8",
			);
			run("cargo", ["fmt", "--all", "--check"]);
			run("cargo", ["check", "--locked", "-p", "cap-desktop"]);
		} else {
			buildSidecars();
			run(
				"bun",
				[
					"run",
					"tauri",
					"build",
					...(profile === "debug" ? ["--debug"] : []),
					"--bundles",
					process.platform === "darwin"
						? "app"
						: process.platform === "win32"
							? "nsis"
							: "deb",
					"--config",
					"src-tauri/tauri.jianku.conf.json",
				],
				desktop,
			);
			signMacBundle();
		}
	}
}

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
