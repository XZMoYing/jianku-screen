import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const [expectedVersion, output, expectedWidth, expectedHeight, expectedFrame] =
	process.argv.slice(2);
if (!expectedVersion || !output)
	throw new Error("expected version and new report path required");
const helper = "/private/tmp/jianku-preview-fullscreen/ax-control";
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
function inspect(port) {
	return new Promise((resolve) => {
		const socket = new WebSocket(`ws://127.0.0.1:${port}/`);
		socket.binaryType = "arraybuffer";
		let ended = false;
		const finish = (value) => {
			if (ended) return;
			ended = true;
			clearTimeout(timer);
			socket.close();
			resolve({ port, ...value });
		};
		const timer = setTimeout(
			() => finish({ frame: null, reason: "no frame in timeout" }),
			4000,
		);
		socket.addEventListener("error", () =>
			finish({ frame: null, reason: "not a frame websocket" }),
		);
		socket.addEventListener("message", (event) => {
			if (!(event.data instanceof ArrayBuffer) || event.data.byteLength < 28)
				return;
			const buffer = event.data;
			const tail = new DataView(buffer, buffer.byteLength - 4, 4).getUint32(
				0,
				true,
			);
			const nv12 = tail === 0x4e563132 || tail === 0x4e563146;
			const size = nv12 ? 28 : 24;
			const view = new DataView(buffer, buffer.byteLength - size, size);
			const stride = view.getUint32(0, true),
				height = view.getUint32(4, true),
				width = view.getUint32(8, true);
			const payloadBytes = buffer.byteLength - size;
			const expectedBytes = nv12
				? stride * (height + Math.floor(height / 2))
				: stride * height;
			const valid =
				width > 0 &&
				height > 0 &&
				width <= 8192 &&
				height <= 8192 &&
				stride >= width * (nv12 ? 1 : 4) &&
				payloadBytes >= expectedBytes;
			if (!valid)
				return finish({
					frame: null,
					reason: "payload did not match frame metadata",
				});
			if (
				expectedWidth &&
				(width !== Number(expectedWidth) || height !== Number(expectedHeight))
			)
				return;
			if (
				expectedFrame !== undefined &&
				view.getUint32(12, true) !== Number(expectedFrame)
			)
				return;
			finish({
				frame: {
					payloadSha256: createHash("sha256")
						.update(new Uint8Array(buffer, 0, payloadBytes))
						.digest("hex"),
					width,
					height,
					stride,
					frameNumber: view.getUint32(12, true),
					targetTimeNs: view.getBigUint64(16, true).toString(),
					payloadBytes,
					expectedBytes,
					format: nv12 ? "NV12" : "RGBA",
				},
			});
		});
	});
}
const observations = await Promise.all(ports.map(inspect));
if (!observations.some((entry) => entry.frame))
	throw new Error("No owned preview frames received");
const report = {
	version,
	pid: state.pid,
	observation:
		"read-only first frame from application-owned loopback listeners; payload discarded",
	observations,
};
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify(report));
