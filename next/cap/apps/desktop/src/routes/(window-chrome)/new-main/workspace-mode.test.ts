import { describe, expect, it, vi } from "vitest";
import {
	createWorkspaceModeChange,
	type WorkspaceMode,
} from "./workspace-mode";

function pending() {
	let resolve!: () => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<void>((accept, fail) => {
		resolve = accept;
		reject = fail;
	});
	return { promise, resolve, reject };
}

function setup(initial: WorkspaceMode = "recording") {
	let mode = initial;
	let locked = false;
	let active = false;
	const requests: ReturnType<typeof pending>[] = [];
	const commit = vi.fn((value: WorkspaceMode) => {
		mode = value;
	});
	const notify = vi.fn();
	const beforeChange = vi.fn(() => {
		const request = pending();
		requests.push(request);
		return request.promise;
	});
	const controller = createWorkspaceModeChange({
		current: () => mode,
		locked: () => locked,
		presentationActive: () => active,
		onPresentationActive: notify,
		beforeChange,
		commit,
	});
	return {
		...controller,
		requests,
		commit,
		notify,
		beforeChange,
		mode: () => mode,
		lock: () => {
			locked = true;
		},
		startPresentation: () => {
			active = true;
		},
	};
}

describe("workspace mode requests", () => {
	it("waits for overlays to close before committing the chosen mode", async () => {
		const control = setup();
		const changed = control.change("presentation");
		expect(control.mode()).toBe("recording");
		expect(control.commit).not.toHaveBeenCalled();
		control.requests[0].resolve();
		expect(await changed).toBe(true);
		expect(control.commit.mock.calls).toEqual([["presentation"]]);
	});
	it("cancels a pending switch when the user reselects the current mode", async () => {
		const control = setup();
		const changed = control.change("presentation");
		expect(await control.change("recording")).toBe(true);
		control.requests[0].resolve();
		expect(await changed).toBe(false);
		expect(control.mode()).toBe("recording");
		expect(control.commit).not.toHaveBeenCalled();
	});
	it("ignores an older request finishing after the latest selection", async () => {
		const control = setup();
		const first = control.change("presentation");
		await control.change("recording");
		const latest = control.change("presentation");
		control.requests[1].resolve();
		await latest;
		control.requests[0].resolve();
		await first;
		expect(control.commit.mock.calls).toEqual([["presentation"]]);
	});
	it("does not switch while the workspace is locked", async () => {
		const control = setup();
		control.lock();
		await control.change("presentation");
		expect(control.beforeChange).not.toHaveBeenCalled();
		expect(control.commit).not.toHaveBeenCalled();
	});
	it("rechecks the recording lock after native work finishes", async () => {
		const control = setup();
		const changed = control.change("presentation");
		control.lock();
		control.requests[0].resolve();
		await changed;
		expect(control.commit).not.toHaveBeenCalled();
	});
	it.each([false, true])(
		"keeps active presentation running (starts during wait: %s)",
		async (duringWait) => {
			const control = setup("presentation");
			if (!duringWait) control.startPresentation();
			const changed = control.change("recording");
			if (duringWait) {
				control.startPresentation();
				control.requests[0].resolve();
			}
			await changed;
			expect(control.notify).toHaveBeenCalledOnce();
			expect(control.commit).not.toHaveBeenCalled();
		},
	);
	it("reports current close failure without changing or persisting the mode", async () => {
		const control = setup();
		const changed = control.change("presentation");
		const failure = new Error("overlay close failed");
		control.requests[0].reject(failure);
		await expect(changed).rejects.toBe(failure);
		expect(control.commit).not.toHaveBeenCalled();
	});
	it("does not show a stale failure after a reversal", async () => {
		const control = setup();
		const changed = control.change("presentation");
		await control.change("recording");
		control.requests[0].reject(new Error("stale failure"));
		await expect(changed).resolves.toBe(false);
		expect(control.commit).not.toHaveBeenCalled();
	});
	it("does not open a library when its mode switch is superseded", async () => {
		const control = setup("presentation");
		const openLibrary = vi.fn();
		const open = async () => {
			if (!(await control.change("recording"))) return;
			openLibrary();
		};
		const requested = open();
		await control.change("presentation");
		control.requests[0].resolve();
		await requested;
		expect(openLibrary).not.toHaveBeenCalled();
		expect(control.commit).not.toHaveBeenCalled();
	});
	it("does not commit or report failures after the page unmounts", async () => {
		const control = setup();
		const changed = control.change("presentation");
		control.dispose();
		control.requests[0].reject(new Error("closed window"));
		await changed;
		await control.change("presentation");
		expect(control.beforeChange).toHaveBeenCalledOnce();
		expect(control.commit).not.toHaveBeenCalled();
	});
});
