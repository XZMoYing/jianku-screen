import { spawnSync } from "node:child_process";
import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const brand = path.resolve(root, "../../assets/branding");
const icons = path.join(root, "apps/desktop/src-tauri/icons/jianku");
const logo = path.join(brand, "jianku-next-logo-approved.png");
const result = spawnSync(
	path.join(root, "node_modules/.bin/tauri"),
	["icon", logo, "--output", icons],
	{ cwd: root, stdio: "inherit" },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
await sharp(logo)
	.resize(256, 256)
	.png()
	.toFile(path.join(root, "apps/desktop/src/assets/branding/logo.png"));
await copyFile(
	path.join(brand, "jianku-next-tray.svg"),
	path.join(icons, "tray.svg"),
);
await sharp(await readFile(path.join(icons, "tray.svg")), { density: 216 })
	.resize(54, 54)
	.png()
	.toFile(path.join(icons, "tray.png"));
