import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const instructions = path.join(root, "scripts/scrcpy");
const manifest = JSON.parse(
	readFileSync(path.join(instructions, "manifest.json")),
);
const native = path.join(root, "target/native-deps");
const cache = path.join(native, "jianku-scrcpy");
const source = path.join(cache, `scrcpy-${manifest.version}`);
const build = path.join(cache, "build");
const environment = { ...process.env };

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: root,
		env: environment,
		encoding: "utf8",
		...options,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`${command} failed: ${result.stderr ?? result.status}`);
	}
	return result.stdout?.trim() ?? "";
}

function sha256(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}

async function download(item, name) {
	const output = path.join(cache, name);
	if (existsSync(output) && sha256(readFileSync(output)) === item.sha256) {
		return output;
	}
	const response = await fetch(item.url);
	if (!response.ok) throw new Error(`Download failed: ${item.url}`);
	const bytes = Buffer.from(await response.arrayBuffer());
	if (sha256(bytes) !== item.sha256) {
		throw new Error(`Checksum mismatch: ${name}`);
	}
	writeFileSync(output, bytes);
	return output;
}

function preparePkgConfig() {
	const nativeAlias = path.join(
		tmpdir(),
		`jianku-native-${sha256(native).slice(0, 16)}`,
	);
	if (existsSync(nativeAlias)) {
		if (realpathSync(nativeAlias) !== realpathSync(native))
			throw new Error("Unexpected native build alias");
	} else {
		symlinkSync(native, nativeAlias, "dir");
	}
	const pc = path.join(cache, "pkgconfig");
	mkdirSync(pc, { recursive: true });
	for (const name of ["avformat", "avcodec", "avutil", "swresample"]) {
		const folder = path.join(native, `include/lib${name}`);
		const version = ["version.h", "version_major.h"]
			.filter((file) => existsSync(path.join(folder, file)))
			.map((file) => readFileSync(path.join(folder, file), "utf8"))
			.join("\n");
		const numbers = ["MAJOR", "MINOR", "MICRO"].map((part) => {
			const value = version.match(
				new RegExp(`LIB${name.toUpperCase()}_VERSION_${part}\\s+(\\d+)`),
			)?.[1];
			if (!value) throw new Error(`Missing bundled FFmpeg headers: ${name}`);
			return value;
		});
		writeFileSync(
			path.join(pc, `lib${name}.pc`),
			`Name: lib${name}\nDescription: Bundled Jianku FFmpeg\nVersion: ${numbers.join(".")}\nLibs: -L"${path.join(nativeAlias, "lib")}" -l${name}\nCflags: -I"${path.join(nativeAlias, "include")}"\n`,
		);
	}
	environment.PKG_CONFIG_PATH = [pc, process.env.PKG_CONFIG_PATH]
		.filter(Boolean)
		.join(path.delimiter);
}

async function main() {
	if (process.platform !== "darwin") return;
	mkdirSync(cache, { recursive: true });
	const archive = await download(
		manifest.source,
		`scrcpy-v${manifest.version}.tar.gz`,
	);
	await download(manifest.server, `scrcpy-server-v${manifest.version}`);
	preparePkgConfig();
	const triple = run("rustc", ["-vV"]).match(/^host:\s*(.+)$/m)?.[1];
	if (!triple?.endsWith("apple-darwin")) throw new Error("macOS host required");
	const sdlVersion = run("pkg-config", ["--modversion", "sdl3"]);
	const ffmpegVersions = ["avformat", "avcodec", "avutil", "swresample"].map(
		(name) =>
			readFileSync(path.join(cache, "pkgconfig", `lib${name}.pc`), "utf8"),
	);
	const fingerprint = sha256(
		JSON.stringify({ manifest, triple, sdlVersion, ffmpegVersions }) +
			readFileSync(fileURLToPath(import.meta.url)) +
			readFileSync(path.join(instructions, "recording-tail.patch")) +
			readFileSync(path.join(instructions, "jianku_tail.h")),
	);
	const statePath = path.join(cache, "build-state.json");
	const state = existsSync(statePath)
		? JSON.parse(readFileSync(statePath))
		: undefined;
	const executable = path.join(build, "app/scrcpy");
	if (state?.fingerprint !== fingerprint || !existsSync(executable)) {
		rmSync(source, { recursive: true, force: true });
		rmSync(build, { recursive: true, force: true });
		run("tar", ["-xzf", archive, "-C", cache]);
		run(
			"patch",
			["-p1", "-i", path.join(instructions, "recording-tail.patch")],
			{
				cwd: source,
			},
		);
		copyFileSync(
			path.join(instructions, "jianku_tail.h"),
			path.join(source, "app/src/jianku_tail.h"),
		);
		run(
			"meson",
			[
				"setup",
				build,
				source,
				"--buildtype=release",
				"-Dcompile_server=false",
				"-Dusb=false",
				"-Dv4l2=false",
				"-Dportable=true",
			],
			{ stdio: "inherit" },
		);
		run("ninja", ["-C", build, "-j2"], { stdio: "inherit" });
		writeFileSync(
			statePath,
			`${JSON.stringify({ fingerprint, version: manifest.version, triple, sdlVersion }, null, 2)}\n`,
		);
	}
	const binaries = path.join(root, "apps/desktop/src-tauri/binaries");
	mkdirSync(binaries, { recursive: true });
	const output = path.join(binaries, `jianku-android-capture-${triple}`);
	copyFileSync(executable, output);
	const sdlPath = path.join(
		run("pkg-config", ["--variable=libdir", "sdl3"]),
		"libSDL3.0.dylib",
	);
	const sdlOutput = path.join(cache, "libSDL3.0.dylib");
	rmSync(sdlOutput, { force: true });
	copyFileSync(sdlPath, sdlOutput);
	chmodSync(sdlOutput, 0o755);
	const dependencies = run("otool", ["-L", output]).split("\n");
	const sdlLink = dependencies
		.find((line) => line.includes("libSDL3."))
		?.trim()
		.split(" (")[0];
	if (!sdlLink) throw new Error("scrcpy is missing SDL3");
	run("install_name_tool", [
		"-change",
		sdlLink,
		"@executable_path/../Frameworks/libSDL3.0.dylib",
		output,
	]);
	run("install_name_tool", [
		"-id",
		"@executable_path/../Frameworks/libSDL3.0.dylib",
		sdlOutput,
	]);
	for (const file of [output, sdlOutput])
		run("codesign", ["--force", "--sign", "-", file]);
	const version = run(output, ["--version"], {
		env: {
			...environment,
			DYLD_LIBRARY_PATH: [cache, path.join(native, "lib")].join(path.delimiter),
		},
	});
	if (!version.startsWith(`scrcpy ${manifest.version} `))
		throw new Error("scrcpy version mismatch");
	console.log(
		`Android capture ${manifest.version} client/server prepared (${sdlVersion} SDL3).`,
	);
}

await main();
