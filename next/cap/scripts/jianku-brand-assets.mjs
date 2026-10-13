import { spawnSync } from "node:child_process";
import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const brand = path.resolve(root, "../../assets/branding");
const icons = path.join(root, "apps/desktop/src-tauri/icons/jianku");
const logo = path.join(brand, "jianku-next-icon.png");
const cutout = await sharp(
	path.join(brand, "jianku-next-icon-cutout-generated.png"),
)
	.extract({ left: 160, top: 153, width: 934, height: 925 })
	.png()
	.toBuffer();
const opaqueTile = await sharp({
	create: {
		width: 934,
		height: 925,
		channels: 4,
		background: { r: 252, g: 251, b: 249, alpha: 1 },
	},
})
	.composite([{ input: cutout }])
	.png()
	.toBuffer();
const masked = await sharp(opaqueTile)
	.composite([
		{
			input: await readFile(path.join(brand, "jianku-next-icon-mask.svg")),
			blend: "dest-in",
		},
	])
	.png()
	.toBuffer();
const tile = await sharp(masked).resize(860, 852).png().toBuffer();
await sharp({
	create: {
		width: 1024,
		height: 1024,
		channels: 4,
		background: { r: 0, g: 0, b: 0, alpha: 0 },
	},
})
	.composite([{ input: tile, left: 82, top: 86 }])
	.png()
	.toFile(logo);
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
