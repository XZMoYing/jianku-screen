import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../apps/desktop/src-tauri",
);
const bundles = { darwin: "app", win32: "nsis", linux: "deb" };

const isObject = (value) =>
	value !== null && typeof value === "object" && !Array.isArray(value);

export function mergeTauriConfig(base, patch) {
	if (!isObject(patch)) return patch;
	const result = isObject(base) ? { ...base } : {};
	for (const [key, value] of Object.entries(patch)) {
		if (value === null) delete result[key];
		else result[key] = mergeTauriConfig(result[key], value);
	}
	return result;
}

export function jiankuBuildConfiguration(platform = process.platform) {
	if (!Object.hasOwn(bundles, platform))
		throw new Error(`尚未配置此平台的构建方式：${platform}`);
	const read = (name) =>
		JSON.parse(readFileSync(path.join(directory, name), "utf8"));
	const common = read("tauri.jianku.conf.json");
	return {
		platform,
		bundle: bundles[platform],
		config:
			platform === "darwin"
				? mergeTauriConfig(common, read("tauri.jianku.macos.json"))
				: common,
	};
}
