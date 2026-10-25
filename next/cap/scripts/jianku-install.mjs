import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, renameSync, rmdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundleId = "com.jianku.screen.next";
const application = "/Applications/Jianku Screen Next.app";
const registrar =
	"/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

export function validMacBuildVersion(value) {
	return typeof value === "string" && /^\d+(?:\.\d+){0,2}$/.test(value);
}

export function registeredCopies(dump, destination) {
	return dump
		.split(
			"--------------------------------------------------------------------------------",
		)
		.filter((record) =>
			/^identifier:\s+com\.jianku\.screen\.next$/m.test(record),
		)
		.map((record) => /^path:\s+(.+?)\s+\(0x[\da-f]+\)$/m.exec(record)?.[1])
		.filter((location) => location && location !== destination);
}

function run(command, args) {
	return execFileSync(command, args, {
		encoding: "utf8",
		stdio: "pipe",
		maxBuffer: 64 * 1024 * 1024,
	});
}

function metadata(applicationPath) {
	const data = JSON.parse(
		run("plutil", [
			"-convert",
			"json",
			"-o",
			"-",
			path.join(applicationPath, "Contents/Info.plist"),
		]),
	);
	if (data.CFBundleIdentifier !== bundleId) {
		throw new Error(`应用标识不匹配，未修改安装：${applicationPath}`);
	}
	return data;
}

function main() {
	if (process.platform !== "darwin") throw new Error("此安装脚本仅用于 macOS");
	const args = process.argv.slice(2);
	const sourceIndex = args.indexOf("--source");
	if (sourceIndex >= 0 && !args[sourceIndex + 1]) {
		throw new Error("--source 后需要提供应用路径");
	}
	const source = path.resolve(
		sourceIndex >= 0
			? args[sourceIndex + 1]
			: path.join(
					root,
					"target",
					args.includes("--debug") ? "debug" : "release",
					"bundle/macos/Jianku Screen Next.app",
				),
	);
	if (source === application) throw new Error("安装源不能与安装目标相同");
	const info = metadata(source);
	if (!validMacBuildVersion(info.CFBundleVersion)) {
		throw new Error(
			"macOS 构建号必须是 1 至 3 段数字，系统会忽略第四段，未修改安装",
		);
	}
	run("codesign", ["--verify", "--deep", "--strict", source]);
	if (args.includes("--check")) {
		console.log(
			`${info.CFBundleShortVersionString}: ${source} → ${application}`,
		);
		return;
	}
	const running = spawnSync(
		"pgrep",
		["-f", "/Contents/MacOS/Jianku Screen Next( |$)"],
		{ encoding: "utf8" },
	);
	if (running.error) throw running.error;
	if (running.status === 0) throw new Error("请先正常退出当前应用，再安装新版");
	if (running.status !== 1)
		throw new Error("无法确认应用是否已退出，未修改安装");
	if (existsSync(application)) metadata(application);
	const staging = mkdtempSync("/Applications/.jianku-next-update-");
	const staged = path.join(staging, "Jianku Screen Next.app");
	const previous = path.join(staging, "previous.app");
	run("ditto", [source, staged]);
	run("codesign", ["--verify", "--deep", "--strict", staged]);
	let movedPrevious = false;
	try {
		if (existsSync(application)) {
			renameSync(application, previous);
			movedPrevious = true;
		}
		renameSync(staged, application);
	} catch (error) {
		if (movedPrevious && !existsSync(application)) {
			renameSync(previous, application);
		}
		throw error;
	}
	if (!movedPrevious) rmdirSync(staging);
	const copies = registeredCopies(run(registrar, ["-dump"]), application);
	for (const location of copies) run(registrar, ["-u", location]);
	run(registrar, ["-f", application]);
	run("swift", [
		"-e",
		'import AppKit; import CoreServices; let status = LSSetDefaultRoleHandlerForContentType("com.jianku.screen.project" as CFString, .all, "com.jianku.screen.next" as CFString); guard status == 0 else { exit(1) }; let expected = URL(fileURLWithPath: CommandLine.arguments.last!).standardizedFileURL; guard NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.jianku.screen.next")?.standardizedFileURL == expected else { exit(2) }',
		application,
	]);
	console.log(`已安装 ${info.CFBundleShortVersionString}：${application}`);
	console.log(`已取消 ${copies.length} 个副本的启动注册，原文件保留。`);
	if (movedPrevious) console.log(`上次安装备份：${previous}`);
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	try {
		main();
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
