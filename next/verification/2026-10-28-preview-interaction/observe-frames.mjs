import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const [expectedVersion, output] = process.argv.slice(2);
if (!expectedVersion || !output)
	throw new Error("expected version and new report path required");
const helper = "/private/tmp/jianku-preview-package/ax-control";
const app = "/Applications/Jianku Screen Next.app";
const state = JSON.parse(execFileSync(helper, [], { encoding: "utf8" }));
if (!state.trusted || state.path !== app || !state.pid)
	throw new Error("Owned application is not available");
const version = execFileSync(
	"/usr/libexec/PlistBuddy",
	["-c", "Print :CFBundleShortVersionString", `${app}/Contents/Info.plist`],
	{ encoding: "utf8" },
).trim();
if (version !== expectedVersion)
	throw new Error(`Unexpected application version ${version}`);
const listing = execFileSync(
	"/usr/sbin/lsof",
	["-nP", "-a", "-p", String(state.pid), "-iTCP", "-sTCP:LISTEN"],
	{ encoding: "utf8" },
);
const ports = [
	...new Set(
		[...listing.matchAll(/127\.0\.0\.1:(\d+) \(LISTEN\)/g)].map((m) =>
			Number(m[1]),
		),
	),
];
if (!ports.length || ports.length > 8)
	throw new Error("Unexpected owned listener count");
const port = Number(process.argv[4]);
if (!ports.includes(port))
	throw new Error("Port is not owned by the current application");
const frames = [];
const socket = new WebSocket(`ws://127.0.0.1:${port}/`);
socket.binaryType = "arraybuffer";
const started = performance.now();
await new Promise((resolve, reject) => {
	const timer = setTimeout(() => {
		socket.close();
		resolve();
	}, 14000);
	socket.addEventListener("error", () => {
		clearTimeout(timer);
		reject(new Error("Owned frame socket failed"));
	});
	socket.addEventListener("open", () => console.log("observer-ready"));
	socket.addEventListener("message", (event) => {
		if (!(event.data instanceof ArrayBuffer) || event.data.byteLength < 28)
			return;
		const b = event.data;
		const magic = new DataView(b, b.byteLength - 4, 4).getUint32(0, true);
		const nv12 = magic === 0x4e563132 || magic === 0x4e563146;
		const metaSize = nv12 ? 28 : 24,
			v = new DataView(b, b.byteLength - metaSize, metaSize);
		const stride = v.getUint32(0, true),
			height = v.getUint32(4, true),
			width = v.getUint32(8, true);
		const bytes = nv12
			? stride * (height + Math.floor(height / 2))
			: stride * height;
		if (
			!width ||
			!height ||
			width > 8192 ||
			height > 8192 ||
			b.byteLength - metaSize < bytes
		)
			return;
		frames.push({
			ms: performance.now() - started,
			width,
			height,
			frameNumber: v.getUint32(12, true),
			targetTimeNs: v.getBigUint64(16, true).toString(),
		});
	});
});
if (!frames.length) throw new Error("No actual frames");
writeFileSync(
	output,
	`${JSON.stringify(
		{
			version,
			pid: state.pid,
			port,
			frames,
			observation:
				"actual preview frame metadata only; excludes display and audio cadence proof",
		},
		null,
		2,
	)}\n`,
	{ flag: "wx" },
);
console.log(
	JSON.stringify({
		frames: frames.length,
		sizes: [...new Set(frames.map((f) => `${f.width}x${f.height}`))],
	}),
);
