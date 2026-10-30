import { createSignal, type Setter, type ValidComponent } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CameraSelect, {
	CameraSelectBase,
} from "~/routes/(window-chrome)/new-main/CameraSelect";
import InfoPill from "~/routes/(window-chrome)/new-main/InfoPill";
import MicrophoneSelect, {
	MicrophoneSelectBase,
} from "~/routes/(window-chrome)/new-main/MicrophoneSelect";
import { setInterfaceLanguage } from "~/utils/i18n";
import type { CameraInfo, OSPermissionsCheck } from "~/utils/tauri";

const io = vi.hoisted(() => ({
	permission: vi.fn(),
	camera: vi.fn(async () => {}),
	windowOpen: vi.fn(async () => false),
	show: vi.fn(async () => {}),
}));
let recording: () => boolean;
let setRecording: Setter<boolean>;
let audio: ((value: number) => void) | undefined;
vi.mock("~/store", () => ({ languageStore: { set: vi.fn(async () => {}) } }));
vi.mock("~/utils/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("~/utils/queries", () => ({
	createCurrentRecordingQuery: () => ({
		get data() {
			return recording();
		},
	}),
}));
vi.mock("~/utils/tauri", () => ({
	commands: {
		isCameraWindowOpen: io.windowOpen,
		setCameraInput: io.camera,
		showWindow: io.show,
	},
	events: { audioInputLevelChange: {} },
}));
vi.mock("~/utils/createEventListener", () => ({
	createTauriEventListener: (
		_event: unknown,
		callback: (value: number) => void,
	) => {
		audio = callback;
	},
}));
vi.mock("~/routes/(window-chrome)/new-main/useRequestPermission", () => ({
	default: () => io.permission,
}));
vi.mock("~/routes/editor/ui", async () => {
	const { Polymorphic } = await import("@kobalte/core/polymorphic");
	const wrapper = (props: Record<string, unknown> & { as: ValidComponent }) => (
		<Polymorphic {...props} />
	);
	return { MenuItem: wrapper, MenuItemList: wrapper, PopperContent: wrapper };
});

const granted: OSPermissionsCheck = {
	camera: "granted",
	microphone: "granted",
	screenRecording: "granted",
	accessibility: "granted",
};
const camera: CameraInfo = {
	device_id: "camera-1",
	model_id: null,
	display_name: "Camera",
};
const base = { class: "row", iconClass: "icon", PillComponent: InfoPill };
let dispose: (() => void) | undefined;
const settle = () => new Promise((resolve) => setTimeout(resolve, 35));
function required<T>(value: T | null | undefined): T {
	if (value == null) throw new Error("Expected device control");
	return value;
}
const button = (label: string) =>
	required(
		Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
			(node) =>
				node.getAttribute("aria-label") === label || node.textContent === label,
		),
	);
const key = (target: Element, name: string) =>
	target.dispatchEvent(
		new KeyboardEvent("keydown", { key: name, bubbles: true }),
	);

beforeEach(async () => {
	[recording, setRecording] = createSignal(false);
	vi.clearAllMocks();
	await setInterfaceLanguage("zh-CN");
	const style = document.createElement("style");
	style.textContent = "* { animation-name: none; }";
	document.head.append(style);
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		value: () => ({
			matches: true,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		}),
	});
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	for (const name of [
		"IconCapCamera",
		"IconCapMicrophone",
		"IconLucideEyeOff",
		"IconLucideSettings",
	])
		vi.stubGlobal(name, (props: { class?: string }) => (
			<svg class={props.class} />
		));
	Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
	dispose?.();
	dispose = undefined;
	audio = undefined;
	document.body.innerHTML = "";
	document.head.innerHTML = "";
	vi.unstubAllGlobals();
});

describe.each(["camera", "microphone"] as const)("%s selector", (kind) => {
	it("requests permission without selecting a device and blocks all controls while recording", async () => {
		const changed = vi.fn();
		const permissions = { ...granted, [kind]: "denied" as const };
		dispose = render(
			() =>
				kind === "camera" ? (
					<CameraSelectBase
						{...base}
						permissions={permissions}
						value={null}
						options={[camera]}
						onChange={changed}
					/>
				) : (
					<MicrophoneSelectBase
						{...base}
						levelIndicatorClass="level"
						permissions={permissions}
						value={null}
						options={["Mic"]}
						onChange={changed}
					/>
				),
			document.body,
		);
		required(
			document.querySelector<HTMLButtonElement>(".jk-device-open"),
		).click();
		expect(io.permission).toHaveBeenCalledWith(kind, "denied");
		expect(document.querySelector('[role="listbox"]')).toBeNull();
		expect(changed).not.toHaveBeenCalled();
		setRecording(true);
		await settle();
		for (const node of document.querySelectorAll<HTMLButtonElement>("button")) {
			expect(node.disabled).toBe(true);
			node.click();
		}
		expect(io.permission).toHaveBeenCalledTimes(1);
		expect(changed).not.toHaveBeenCalled();
	});
	it("opens from Off without writing and closes an open list when recording starts", async () => {
		const changed = vi.fn();
		dispose = render(
			() =>
				kind === "camera" ? (
					<CameraSelectBase
						{...base}
						permissions={granted}
						value={null}
						options={[]}
						onChange={changed}
					/>
				) : (
					<MicrophoneSelectBase
						{...base}
						levelIndicatorClass="level"
						permissions={granted}
						value={null}
						options={[]}
						onChange={changed}
					/>
				),
			document.body,
		);
		button("关闭").click();
		await settle();
		expect(document.querySelectorAll('[role="option"]').length).toBe(1);
		expect(changed).not.toHaveBeenCalled();
		setRecording(true);
		await settle();
		expect(document.querySelector('[role="listbox"]')).toBeNull();
		for (const node of document.querySelectorAll<HTMLButtonElement>("button"))
			expect(node.disabled).toBe(true);
	});
});
it("keeps camera identity, verbatim names and a disabled disconnected selection", async () => {
	const [options, setOptions] = createSignal([camera]);
	const changed = vi.fn();
	dispose = render(
		() => (
			<CameraSelectBase
				{...base}
				permissions={granted}
				value={camera}
				options={options()}
				onChange={changed}
			/>
		),
		document.body,
	);
	expect(button("摄像头").textContent).toContain("Camera");
	setOptions([{ ...camera, display_name: "Reconnected Camera" }]);
	await settle();
	expect(button("摄像头").textContent).toContain("Reconnected Camera");
	setOptions([]);
	await settle();
	expect(button("摄像头").textContent).toContain("Camera");
	button("摄像头").click();
	await settle();
	expect(
		document.querySelector('[role="option"][data-disabled]'),
	).not.toBeNull();
	expect(changed).not.toHaveBeenCalled();
});
it("distinguishes a microphone named none and clears it only by explicit selection", async () => {
	const changed = vi.fn();
	dispose = render(
		() => (
			<MicrophoneSelectBase
				{...base}
				levelIndicatorClass="level"
				permissions={granted}
				value="none"
				options={["none", "Mic"]}
				onChange={changed}
			/>
		),
		document.body,
	);
	const trigger = button("麦克风");
	expect(trigger.textContent).toContain("none");
	required(audio)(0);
	await settle();
	expect(document.querySelector('[style*="right: 0%"]')).not.toBeNull();
	trigger.click();
	await settle();
	expect(document.querySelectorAll('[role="option"]').length).toBe(3);
	key(required(document.querySelector('[role="listbox"]')), "Home");
	await settle();
	key(required(document.activeElement), "Enter");
	await settle();
	expect(changed).toHaveBeenCalledTimes(1);
	expect(changed).toHaveBeenCalledWith(null);
	expect(document.querySelector('[style*="right: 0%"]')).toBeNull();
});
it("keeps homepage camera shortcuts separate from the menu and disables every action", async () => {
	const opened = vi.fn();
	const settings = vi.fn();
	const changed = vi.fn();
	dispose = render(
		() => (
			<CameraSelect
				options={[camera]}
				value={camera}
				permissions={granted}
				onChange={changed}
				onOpen={opened}
				onOpenSettings={settings}
			/>
		),
		document.body,
	);
	await settle();
	expect(document.querySelector("button button")).toBeNull();
	button("显示摄像头预览").click();
	await settle();
	expect(io.camera).toHaveBeenCalledWith({ DeviceID: "camera-1" }, false);
	button("摄像头设置").click();
	expect(settings).toHaveBeenCalledTimes(1);
	expect(opened).not.toHaveBeenCalled();
	expect(changed).not.toHaveBeenCalled();
	setRecording(true);
	await settle();
	for (const node of document.querySelectorAll<HTMLButtonElement>("button"))
		expect(node.disabled).toBe(true);
});
it("preserves microphone level zero and the homepage Off menu action", async () => {
	const [value, setValue] = createSignal<string | null>("Mic");
	const opened = vi.fn();
	dispose = render(
		() => (
			<MicrophoneSelect
				options={["Mic"]}
				value={value()}
				permissions={granted}
				onChange={vi.fn()}
				onOpen={opened}
			/>
		),
		document.body,
	);
	required(audio)(0);
	await settle();
	expect(document.querySelector('[style*="right: 0%"]')).not.toBeNull();
	setValue(null);
	await settle();
	expect(document.querySelector('[style*="right: 0%"]')).toBeNull();
	button("关闭").click();
	expect(opened).toHaveBeenCalledTimes(1);
	expect(document.querySelector("button button")).toBeNull();
});
