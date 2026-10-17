import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderFrameWebGPU } from "./webgpu-renderer";

vi.mock("./webgpu-renderer", () => ({
	isWebGPUSupported: vi.fn(async () => true),
	initWebGPU: vi.fn(async () => ({})),
	renderFrameWebGPU: vi.fn(),
	renderNv12FrameWebGPU: vi.fn(),
	disposeWebGPU: vi.fn(),
}));

describe("frame worker presentation scheduling", () => {
	const postMessage = vi.fn();
	const raf = vi.fn();
	const host: {
		postMessage: typeof postMessage;
		onmessage: ((event: MessageEvent) => Promise<void>) | null;
	} = { postMessage, onmessage: null };
	const dispatch = (data: unknown) =>
		host.onmessage?.(new MessageEvent("message", { data }));
	const frame = (number: number) => {
		const buffer = new ArrayBuffer(40);
		new Uint8Array(buffer, 0, 16).fill(127);
		const metadata = new DataView(buffer, 16);
		metadata.setUint32(0, 8, true);
		metadata.setUint32(4, 2, true);
		metadata.setUint32(8, 2, true);
		metadata.setUint32(12, number, true);
		return { type: "frame", buffer };
	};
	beforeEach(async () => {
		vi.resetModules();
		vi.clearAllMocks();
		host.onmessage = null;
		vi.stubGlobal("self", host);
		vi.stubGlobal("requestAnimationFrame", raf);
		vi.stubGlobal("cancelAnimationFrame", vi.fn());
		await import("./frame-worker");
	});
	afterEach(() => vi.unstubAllGlobals());

	it("presents every received live frame even when browser animation callbacks stop", async () => {
		await dispatch({ type: "init-canvas", canvas: {}, renderOnArrival: true });
		for (let number = 1; number <= 3; number++) await dispatch(frame(number));
		expect(raf).not.toHaveBeenCalled();
		expect(renderFrameWebGPU).toHaveBeenCalledTimes(3);
		const rendered = postMessage.mock.calls
			.map(([message]) => message)
			.filter((message) => message.type === "frame-rendered");
		expect(rendered.map((message) => message.frameNumber)).toEqual([1, 2, 3]);
		expect(Array.from(vi.mocked(renderFrameWebGPU).mock.calls[0][1])).toEqual(
			Array(16).fill(127),
		);
	});

	it("keeps the editor's animation callback scheduling by default", async () => {
		await dispatch({ type: "init-canvas", canvas: {} });
		await dispatch(frame(1));
		expect(renderFrameWebGPU).not.toHaveBeenCalled();
		expect(raf).toHaveBeenCalledTimes(1);
		raf.mock.calls[0][0]();
		expect(renderFrameWebGPU).toHaveBeenCalledOnce();
	});

	it("presents a frame queued before the live canvas finishes initializing", async () => {
		const initialization = dispatch({
			type: "init-canvas",
			canvas: {},
			renderOnArrival: true,
		});
		await dispatch(frame(9));
		await initialization;
		expect(raf).not.toHaveBeenCalled();
		expect(renderFrameWebGPU).toHaveBeenCalledOnce();
		expect(postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: "frame-rendered", frameNumber: 9 }),
		);
	});
});
