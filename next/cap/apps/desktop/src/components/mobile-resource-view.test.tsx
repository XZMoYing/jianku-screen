import { createSignal, For, Suspense } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, expect, it, vi } from "vitest";
import type { MobileProject, MobileSetup } from "~/utils/tauri";
import MobileRecorder from "./MobileRecorder";

const io = vi.hoisted(() => ({
	setup: vi.fn(),
	projects: vi.fn(),
	start: vi.fn(),
}));
vi.mock("~/utils/tauri", () => ({
	commands: {
		getMobileSetup: io.setup,
		listMobileProjects: io.projects,
		getMobileStatus: async () => ({ active: false, phase: "idle" }),
		startMobileRecording: io.start,
	},
}));
vi.mock("~/utils/i18n", () => ({ t: (value: string) => value }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));
vi.mock("./ChoiceSelect", () => ({
	ChoiceSelect: (props: {
		"aria-label"?: string;
		options: { value: string; label: string }[];
	}) => (
		<select aria-label={props["aria-label"]}>
			<For each={props.options}>
				{(option) => <option value={option.value}>{option.label}</option>}
			</For>
		</select>
	),
}));

const setup: MobileSetup = {
	devices: [],
	androidReady: true,
	iosReady: true,
	warnings: [],
};
const project = (name: string): MobileProject => ({
	path: `/synthetic/${name}.jks`,
	name,
	phase: "complete",
	hasSource: true,
});
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((accept) => {
		resolve = accept;
	});
	return { promise, resolve };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 25));
let dispose: (() => void) | undefined;
afterEach(() => {
	dispose?.();
	dispose = undefined;
	document.body.innerHTML = "";
	localStorage.clear();
	vi.resetAllMocks();
});

function mount() {
	const [visible, setVisible] = createSignal(true);
	dispose = render(
		() => (
			<Suspense fallback={<p data-loading>Initial loading</p>}>
				<MobileRecorder
					visible={visible()}
					blocked={false}
					onActive={() => {}}
				/>
			</Suspense>
		),
		document.body,
	);
	return setVisible;
}
function recorder() {
	const node = document.querySelector<HTMLElement>(".mobile-recorder");
	if (!node) throw new Error("Expected connected mobile recorder");
	return node;
}

it("keeps the initial loading boundary until the first device and history results arrive", async () => {
	const devices = deferred<MobileSetup>();
	const history = deferred<MobileProject[]>();
	io.setup.mockReturnValue(devices.promise);
	io.projects.mockReturnValue(history.promise);
	mount();
	expect(document.querySelector("[data-loading]")).not.toBeNull();
	devices.resolve(setup);
	await settle();
	expect(document.querySelector("[data-loading]")).not.toBeNull();
	history.resolve([project("Initial")]);
	await settle();
	expect(recorder().textContent).toContain("Initial");
	expect(document.querySelector("[data-loading]")).toBeNull();
});

it("keeps the same connected scroll container during device and history refresh after returning", async () => {
	io.setup.mockResolvedValue(setup);
	io.projects.mockResolvedValue([project("Before refresh")]);
	const setVisible = mount();
	await settle();
	const original = recorder();
	const devices = deferred<MobileSetup>();
	const history = deferred<MobileProject[]>();
	io.setup.mockReturnValue(devices.promise);
	io.projects.mockReturnValue(history.promise);
	setVisible(false);
	await settle();
	setVisible(true);
	await settle();
	expect(original.isConnected).toBe(true);
	expect(recorder()).toBe(original);
	expect(document.querySelector("[data-loading]")).toBeNull();
	expect(original.textContent).toContain("Before refresh");
	devices.resolve({ ...setup, warnings: ["Fresh device information"] });
	await settle();
	expect(original.isConnected).toBe(true);
	expect(original.textContent).toContain("Fresh device information");
	history.resolve([project("After refresh")]);
	await settle();
	expect(recorder()).toBe(original);
	expect(original.textContent).toContain("After refresh");
	expect(original.textContent).not.toContain("Before refresh");
	expect(io.setup).toHaveBeenCalledTimes(2);
	expect(io.projects).toHaveBeenCalledTimes(2);
});

it("shows refreshed history without detaching the container during an explicit refresh", async () => {
	io.setup.mockResolvedValue(setup);
	io.projects.mockResolvedValue([project("Before refresh")]);
	mount();
	await settle();
	const original = recorder();
	const history = deferred<MobileProject[]>();
	io.projects.mockReturnValue(history.promise);
	const refresh = Array.from(original.querySelectorAll("button")).find(
		(node) => node.textContent?.trim() === "刷新列表",
	);
	if (!refresh) throw new Error("Expected history refresh control");
	refresh.click();
	await settle();
	expect(original.isConnected).toBe(true);
	expect(original.textContent).toContain("Before refresh");
	history.resolve([project("After refresh")]);
	await settle();
	expect(recorder()).toBe(original);
	expect(original.textContent).toContain("After refresh");
});

it("keeps capture disabled until a cached device has been checked again", async () => {
	const connected: MobileSetup = {
		...setup,
		devices: [
			{
				id: "synthetic-device",
				name: "Synthetic device",
				platform: "android",
				authorized: true,
				audioSupported: true,
				mi6Compatibility: false,
			},
		],
	};
	io.setup.mockResolvedValue(connected);
	io.projects.mockResolvedValue([]);
	const setVisible = mount();
	await settle();
	const original = recorder();
	const start = original.querySelector<HTMLButtonElement>(
		".mobile-record-button",
	);
	if (!start) throw new Error("Expected capture control");
	expect(start.disabled).toBe(false);
	const devices = deferred<MobileSetup>();
	io.setup.mockReturnValue(devices.promise);
	setVisible(false);
	await settle();
	setVisible(true);
	await settle();
	expect(original.isConnected).toBe(true);
	expect(start.disabled).toBe(true);
	start.click();
	expect(io.start).not.toHaveBeenCalled();
	devices.resolve(connected);
	await settle();
	expect(start.disabled).toBe(false);
	expect(io.start).not.toHaveBeenCalled();
});
