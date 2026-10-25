import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPreparingFrameLease } from "~/routes/editor/preparing-frame-lease";
import { createImageDataWS } from "~/utils/socket";
import { attachPreparingFrameTransport } from "./preparing-frame-transport";

const sockets = vi.hoisted(() => {
	class Socket extends EventTarget {
		static readonly CONNECTING = 0;
		static readonly OPEN = 1;
		static readonly CLOSING = 2;
		static readonly CLOSED = 3;
		static instances: Socket[] = [];
		readyState = Socket.OPEN;
		binaryType = "blob";
		onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
		constructor(readonly url: string) {
			super();
			Socket.instances.push(this);
		}
		close() {
			if (this.readyState === Socket.CLOSED) return;
			this.readyState = Socket.CLOSED;
			this.dispatchEvent(new Event("close"));
		}
		fail() {
			this.dispatchEvent(new Event("error"));
		}
		frame(bytes: ArrayBuffer) {
			this.onmessage?.({ data: bytes });
		}
	}
	return { Socket };
});

vi.mock("@solid-primitives/websocket", () => ({
	createWS: (url: string) => new sockets.Socket(url),
}));
vi.mock("~/utils/frame-worker?worker", () => ({
	default: class {
		constructor() {
			throw new Error(
				"The first-frame direct canvas must not allocate a worker",
			);
		}
	},
}));

const strideReplies = vi.hoisted(() => ({ pending: [] as (() => void)[] }));
vi.mock("~/utils/stride-correction-worker?worker", () => ({
	default: class {
		onmessage: ((event: { data: Record<string, unknown> }) => void) | null =
			null;
		postMessage(request: {
			buffer: ArrayBuffer;
			strideBytes: number;
			width: number;
			height: number;
			frameNumber: number;
			targetTimeNs: bigint;
			generation: number;
		}) {
			const pixels = new Uint8Array(request.width * request.height * 4);
			const source = new Uint8Array(request.buffer);
			for (let row = 0; row < request.height; row++) {
				pixels.set(
					source.subarray(
						row * request.strideBytes,
						row * request.strideBytes + request.width * 4,
					),
					row * request.width * 4,
				);
			}
			strideReplies.pending.push(() =>
				this.onmessage?.({
					data: { ...request, type: "corrected", buffer: pixels.buffer },
				}),
			);
		}
		terminate() {}
	},
}));

class Pixels {
	readonly data: Uint8ClampedArray;
	constructor(
		readonly width: number,
		readonly height: number,
	) {
		this.data = new Uint8ClampedArray(width * height * 4);
	}
}

class Canvas {
	width = 0;
	height = 0;
	isConnected = true;
	pixels: number[] = [];
	getContext() {
		return {
			putImageData: (image: Pixels) => {
				this.pixels = Array.from(image.data);
			},
		};
	}
	asElement() {
		return this as unknown as HTMLCanvasElement;
	}
}

const rgba = [29, 61, 127, 255];
let scheduled: Map<number, FrameRequestCallback>;
let nextFrame: number;
let now: number;

function packedFrame(pixels = rgba, frameNumber = 0, targetTimeNs = 0n) {
	const buffer = new ArrayBuffer(rgba.length + 24);
	new Uint8Array(buffer).set(pixels);
	const metadata = new DataView(buffer, rgba.length, 24);
	metadata.setUint32(0, 4, true);
	metadata.setUint32(4, 1, true);
	metadata.setUint32(8, 1, true);
	metadata.setUint32(12, frameNumber, true);
	metadata.setBigUint64(16, targetTimeNs, true);
	return buffer;
}

function renderScheduledFrame(timestamp = now + 1000 / 60) {
	now = timestamp;
	const callbacks = Array.from(scheduled.values());
	scheduled.clear();
	for (const callback of callbacks) callback(timestamp);
}

async function mount() {
	const canvas = new Canvas();
	const retainedCanvas = new Canvas();
	const rendered = vi.fn();
	const frame = vi.fn();
	const ended = vi.fn();
	const stop = vi.fn(async (_epoch: number) => {});
	const lease = createPreparingFrameLease({
		start: async () => "ws://127.0.0.1/owned",
		stop,
		ended,
		attach: (url, isActive) =>
			attachPreparingFrameTransport({
				url,
				canvas: canvas.asElement(),
				retainedCanvas: retainedCanvas.asElement(),
				isActive,
				onRendered: rendered,
				onFrame: frame,
				onTerminal: () => lease.finish(),
			}),
	});
	await lease.start();
	const socket = sockets.Socket.instances.at(-1);
	if (!socket)
		throw new Error("Expected the actual socket utility to create a websocket");
	return {
		canvas,
		retainedCanvas,
		rendered,
		frame,
		ended,
		stop,
		lease,
		socket,
	};
}

beforeEach(() => {
	strideReplies.pending = [];
	sockets.Socket.instances = [];
	scheduled = new Map();
	nextFrame = 0;
	now = 0;
	vi.spyOn(performance, "now").mockImplementation(() => now);
	vi.stubGlobal("WebSocket", sockets.Socket);
	vi.stubGlobal("ImageData", Pixels);
	vi.stubGlobal("navigator", {});
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		const id = ++nextFrame;
		scheduled.set(id, callback);
		return id;
	});
	vi.stubGlobal("cancelAnimationFrame", (id: number) => scheduled.delete(id));
});

describe("ordered editor presentation with the actual socket utility", () => {
	const create = (preserveFrameOrder = true) => {
		const canvas = new Canvas();
		const displayed: number[] = [];
		const [, , , controls] = createImageDataWS(
			"ws://ordered-editor",
			(frame) => {
				if (frame.renderedFrame)
					displayed.push(frame.renderedFrame.frameNumber);
			},
			undefined,
			{ preserveFrameOrder },
		);
		controls.initDirectCanvas(canvas.asElement());
		const socket = sockets.Socket.instances.at(-1);
		if (!socket) throw new Error("Expected editor socket");
		const send = (number: number, color = rgba) =>
			socket.frame(packedFrame(color, number, BigInt(number) * 16_666_667n));
		return { canvas, displayed, controls, socket, send };
	};

	it("presents two sequential arrivals on consecutive refreshes without replacing pixels", () => {
		const view = create();
		view.send(1);
		view.send(2, [200, 151, 80, 255]);
		renderScheduledFrame();
		expect(view.displayed).toEqual([1]);
		expect(view.canvas.pixels).toEqual(rgba);
		renderScheduledFrame();
		expect(view.displayed).toEqual([1, 2]);
		expect(view.canvas.pixels).toEqual([200, 151, 80, 255]);
	});

	it("draws padded rows on the refresh without allocating an asynchronous stride worker", () => {
		const view = create();
		const pixels = [...rgba, 255, 0, 200, 255];
		const bytes = new ArrayBuffer(16 + 24);
		new Uint8Array(bytes).set([
			...rgba,
			99,
			99,
			99,
			99,
			...pixels.slice(4),
			88,
			88,
			88,
			88,
		]);
		const metadata = new DataView(bytes, 16);
		metadata.setUint32(0, 8, true);
		metadata.setUint32(4, 2, true);
		metadata.setUint32(8, 1, true);
		metadata.setUint32(12, 12, true);
		metadata.setBigUint64(16, 200_000_000n, true);
		view.socket.frame(bytes);
		expect(view.displayed).toEqual([]);
		renderScheduledFrame();
		expect(view.displayed).toEqual([12]);
		expect(view.canvas.pixels).toEqual(pixels);
		expect(strideReplies.pending).toEqual([]);
	});

	it("buffers arrival jitter and presents one frame per refresh without changing pixels", () => {
		const view = create();
		view.send(0);
		renderScheduledFrame(0);
		now = 17;
		view.send(1);
		renderScheduledFrame(1000 / 60);
		now = 34;
		view.send(2);
		renderScheduledFrame(1000 / 30);
		expect(view.displayed).toEqual([0]);
		renderScheduledFrame(50);
		now = 68;
		view.send(3);
		view.send(4);
		for (const timestamp of [200 / 3, 250 / 3, 100])
			renderScheduledFrame(timestamp);
		expect(view.displayed).toEqual([0, 1, 2, 3, 4]);
	});

	it("keeps queued frames across a small producer gap instead of clearing the buffer", () => {
		const view = create();
		view.send(10);
		view.send(11);
		view.send(13);
		for (const timestamp of [0, 1000 / 60, 1000 / 30, 50])
			renderScheduledFrame(timestamp);
		expect(view.displayed).toEqual([10, 11, 13]);
	});

	it("honors 30 fps timestamps on a 60 Hz display even when frames arrive together", () => {
		const view = create();
		for (let frame = 0; frame < 3; frame++) {
			view.socket.frame(packedFrame(rgba, frame, BigInt(frame) * 33_333_333n));
		}
		renderScheduledFrame(0);
		renderScheduledFrame(1000 / 60);
		expect(view.displayed).toEqual([0]);
		renderScheduledFrame(1000 / 30);
		expect(view.displayed).toEqual([0, 1]);
		renderScheduledFrame(50);
		expect(view.displayed).toEqual([0, 1]);
		renderScheduledFrame(200 / 3);
		expect(view.displayed).toEqual([0, 1, 2]);
	});

	it("does not delay a paused seek after a long gap in arrivals", () => {
		const view = create();
		view.send(1);
		renderScheduledFrame();
		now = 17;
		view.send(2);
		now = 500;
		view.send(3);
		renderScheduledFrame(501);
		expect(view.displayed).toEqual([1, 3]);
	});

	it("preserves latest-frame behavior for other consumers", () => {
		const view = create(false);
		view.send(1);
		view.send(2);
		renderScheduledFrame();
		expect(view.displayed).toEqual([2]);
	});

	it("keeps NV12 frames in order without changing converted pixels", () => {
		const view = create();
		for (const number of [1, 2]) {
			const frame = new ArrayBuffer(6 + 28);
			new Uint8Array(frame).set([16, 16, 16, 16, 128, 128]);
			const metadata = new DataView(frame, 6);
			metadata.setUint32(0, 2, true);
			metadata.setUint32(4, 2, true);
			metadata.setUint32(8, 2, true);
			metadata.setUint32(12, number, true);
			metadata.setBigUint64(16, BigInt(number) * 16_666_667n, true);
			metadata.setUint32(24, 0x4e563132, true);
			view.socket.frame(frame);
		}
		renderScheduledFrame();
		expect(view.displayed).toEqual([1]);
		renderScheduledFrame();
		expect(view.displayed).toEqual([1, 2]);
		expect(view.canvas.pixels).toEqual(
			Array.from({ length: 4 }, () => [0, 0, 0, 255]).flat(),
		);
	});

	it("drops frames from the previous output size before presenting a resized canvas", () => {
		const view = create();
		view.send(1);
		const frame = new ArrayBuffer(8 + 24);
		new Uint8Array(frame).set([...rgba, ...rgba]);
		const metadata = new DataView(frame, 8);
		metadata.setUint32(0, 8, true);
		metadata.setUint32(4, 1, true);
		metadata.setUint32(8, 2, true);
		metadata.setUint32(12, 2, true);
		metadata.setBigUint64(16, 33_333_334n, true);
		view.socket.frame(frame);
		renderScheduledFrame();
		expect(view.displayed).toEqual([2]);
		expect(view.canvas.width).toBe(2);
		expect(view.canvas.pixels).toEqual([...rgba, ...rgba]);
	});

	it("bounds backlog to four frames", () => {
		const view = create();
		for (let index = 1; index <= 8; index++) view.send(index);
		for (let index = 0; index < 4; index++) renderScheduledFrame();
		expect(view.displayed).toEqual([5, 6, 7, 8]);
	});

	it.each([0, 100])(
		"discards the old queue on a seek to frame %s",
		(target) => {
			const view = create();
			view.send(10);
			view.send(11);
			view.send(target);
			renderScheduledFrame();
			renderScheduledFrame();
			expect(view.displayed).toEqual([target]);
		},
	);

	it("replaces queued paused-frame edits and cancels old frames on reset or disposal", () => {
		const view = create();
		view.send(10);
		view.send(10, [200, 151, 80, 255]);
		renderScheduledFrame();
		expect(view.canvas.pixels).toEqual([200, 151, 80, 255]);
		view.send(11);
		view.controls.resetFrameState();
		renderScheduledFrame();
		expect(view.displayed).toEqual([10]);
		view.send(0);
		view.controls.dispose();
		renderScheduledFrame();
		expect(view.displayed).toEqual([10]);
	});

	it("rejects a late stride-worker reply from before a seek for other consumers", () => {
		const view = create(false);
		const padded = (number: number, color: number[]) => {
			const frame = new ArrayBuffer(8 + 24);
			new Uint8Array(frame).set(color);
			const metadata = new DataView(frame, 8);
			metadata.setUint32(0, 8, true);
			metadata.setUint32(4, 1, true);
			metadata.setUint32(8, 1, true);
			metadata.setUint32(12, number, true);
			metadata.setBigUint64(16, BigInt(number) * 16_666_667n, true);
			return frame;
		};
		view.socket.frame(padded(10, rgba));
		renderScheduledFrame();
		view.controls.resetFrameState();
		view.socket.frame(padded(0, [200, 151, 80, 255]));
		renderScheduledFrame();
		strideReplies.pending[0]();
		expect(view.displayed).toEqual([]);
		strideReplies.pending[1]();
		expect(view.displayed).toEqual([0]);
		expect(view.canvas.pixels).toEqual([200, 151, 80, 255]);
	});
});

afterEach(() => {
	for (const socket of sockets.Socket.instances) socket.close();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("preparing transport with the actual socket utility", () => {
	it("demonstrates that a later terminal listener cannot copy the disposed socket frame", () => {
		const canvas = new Canvas();
		const retainedCanvas = new Canvas();
		const [socket, , , controls] = createImageDataWS(
			"ws://old-order",
			() => {},
		);
		controls.initDirectCanvas(canvas.asElement());
		let copied: boolean | undefined;
		socket.addEventListener("close", () => {
			copied = controls.drawLatestFrameToCanvas(retainedCanvas.asElement());
		});
		const source = sockets.Socket.instances[0];
		source.frame(packedFrame());
		renderScheduledFrame();
		expect(canvas.pixels).toEqual(rgba);
		source.close();
		expect(copied).toBe(false);
		expect(retainedCanvas.pixels).toEqual([]);
	});

	it.each(["close", "error"] as const)(
		"retains exact displayed pixels through earlier socket %s cleanup",
		async (event) => {
			const mounted = await mount();
			mounted.socket.frame(packedFrame());
			expect(mounted.rendered).not.toHaveBeenCalled();
			renderScheduledFrame();
			expect(mounted.canvas.pixels).toEqual(rgba);
			expect(mounted.retainedCanvas.pixels).toEqual(rgba);
			expect(mounted.rendered).toHaveBeenLastCalledWith(true);
			if (event === "close") mounted.socket.close();
			else mounted.socket.fail();
			expect(mounted.ended).toHaveBeenCalledWith(true);
			expect(mounted.retainedCanvas.pixels).toEqual(rgba);
			expect(mounted.lease.isActive()).toBe(false);
			expect(mounted.stop).toHaveBeenCalledTimes(1);
			mounted.lease.close();
			expect(mounted.stop).toHaveBeenCalledTimes(1);
		},
	);

	it("acknowledges the exact nonzero RGBA identity only after the scheduled pixels render", async () => {
		const mounted = await mount();
		mounted.socket.frame(packedFrame(rgba, 315, 10_500_000_000n));
		expect(mounted.frame).not.toHaveBeenCalled();
		renderScheduledFrame();
		expect(mounted.frame).toHaveBeenLastCalledWith({
			width: 1,
			height: 1,
			renderedFrame: { frameNumber: 315, targetTimeNs: 10_500_000_000n },
		});
		mounted.lease.close();
	});

	it("carries exact NV12 identity through the actual fallback draw", async () => {
		const mounted = await mount();
		const buffer = new ArrayBuffer(6 + 28);
		new Uint8Array(buffer).set([16, 16, 16, 16, 128, 128]);
		const metadata = new DataView(buffer, 6, 28);
		metadata.setUint32(0, 2, true);
		metadata.setUint32(4, 2, true);
		metadata.setUint32(8, 2, true);
		metadata.setUint32(12, 216000, true);
		metadata.setBigUint64(16, 7_200_000_000_000n, true);
		metadata.setUint32(24, 0x4e563132, true);
		mounted.socket.frame(buffer);
		expect(mounted.frame).not.toHaveBeenCalled();
		renderScheduledFrame();
		expect(mounted.frame).toHaveBeenLastCalledWith({
			width: 2,
			height: 2,
			renderedFrame: { frameNumber: 216000, targetTimeNs: 7_200_000_000_000n },
		});
		expect(mounted.canvas.pixels).toEqual([
			0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255,
		]);
		mounted.lease.close();
	});

	it("retains the latest displayed frame rather than the first frame when playback ends", async () => {
		const mounted = await mount();
		mounted.socket.frame(packedFrame());
		renderScheduledFrame();
		const later = [200, 151, 80, 255];
		mounted.socket.frame(packedFrame(later));
		renderScheduledFrame();
		expect(mounted.canvas.pixels).toEqual(later);
		expect(mounted.retainedCanvas.pixels).toEqual(rgba);
		mounted.socket.close();
		expect(mounted.retainedCanvas.pixels).toEqual(later);
		expect(mounted.ended).toHaveBeenCalledWith(true);
	});

	it("keeps the ordinary spinner when finalization ends before a queued frame renders", async () => {
		const mounted = await mount();
		mounted.socket.frame(packedFrame());
		expect(scheduled.size).toBe(1);
		mounted.socket.close();
		renderScheduledFrame();
		expect(mounted.rendered).not.toHaveBeenCalled();
		expect(mounted.ended).toHaveBeenCalledWith(false);
		expect(mounted.retainedCanvas.pixels).toEqual([]);
	});

	it("cannot attach old pixels to a new lease after the first skeleton unmounts", async () => {
		const old = await mount();
		old.socket.frame(packedFrame());
		old.lease.close();
		const next = await mount();
		renderScheduledFrame();
		expect(old.rendered).not.toHaveBeenCalled();
		expect(old.retainedCanvas.pixels).toEqual([]);
		expect(next.retainedCanvas.pixels).toEqual([]);
		expect(next.lease.isActive()).toBe(true);
		next.socket.frame(packedFrame());
		renderScheduledFrame();
		expect(next.retainedCanvas.pixels).toEqual(rgba);
		next.lease.close();
	});
});
