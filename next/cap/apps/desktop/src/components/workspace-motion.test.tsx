import { createSignal, onCleanup, type ValidComponent } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChoiceSelect } from "./ChoiceSelect";
import { MotionPanel, MotionPresence, MotionSwitch } from "./InterfaceMotion";

vi.mock("~/store", () => ({ languageStore: { set: vi.fn(async () => {}) } }));
vi.mock("~/routes/editor/ui", async () => {
	const { Polymorphic } = await import("@kobalte/core/polymorphic");
	const wrapper = (props: Record<string, unknown> & { as: ValidComponent }) => (
		<Polymorphic {...props} />
	);
	return { MenuItem: wrapper, MenuItemList: wrapper, PopperContent: wrapper };
});

function required<T>(value: T | undefined | null): T {
	if (value == null) throw new Error("Expected workspace control");
	return value;
}
let dispose: (() => void) | undefined;
let reduce = false;
let media: EventTarget;
const animations: {
	target: Element;
	cancel: ReturnType<typeof vi.fn>;
	resolve: () => void;
}[] = [];
const settle = () => new Promise((resolve) => setTimeout(resolve, 35));
const element = (selector: string) =>
	required(document.querySelector<HTMLElement>(selector));
const outgoing = (selector: string) =>
	required(
		[...animations]
			.reverse()
			.find((animation) => animation.target === element(selector)),
	);

beforeEach(() => {
	reduce = false;
	media = new EventTarget();
	Object.defineProperty(media, "matches", { get: () => reduce });
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		value: () => media,
	});
	Object.defineProperty(document, "visibilityState", {
		configurable: true,
		value: "visible",
	});
	const style = document.createElement("style");
	style.textContent = "* { animation-name: none; }";
	document.head.append(style);
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	Element.prototype.scrollIntoView = vi.fn();
	Element.prototype.animate = function () {
		let resolve!: () => void;
		const finished = new Promise<void>((accept) => {
			resolve = accept;
		});
		const cancel = vi.fn(resolve);
		animations.push({ target: this, cancel, resolve });
		return { cancel, finished } as unknown as Animation;
	};
});
afterEach(() => {
	dispose?.();
	dispose = undefined;
	document.body.innerHTML = "";
	document.head.innerHTML = "";
	animations.length = 0;
	vi.unstubAllGlobals();
});

function mount() {
	const [mode, setMode] = createSignal<"recording" | "presentation">(
		"recording",
	);
	const [source, setSource] = createSignal<"desktop" | "mobile">("desktop");
	const mounted = vi.fn();
	const removed = vi.fn();
	const changed = vi.fn();
	const modeButtons: Partial<
		Record<"recording" | "presentation", HTMLButtonElement>
	> = {};
	const sourceButtons: Partial<
		Record<"desktop" | "mobile", HTMLButtonElement>
	> = {};
	function Panel(props: { name: string }) {
		mounted(props.name);
		const [text, setText] = createSignal("");
		onCleanup(() => removed(props.name));
		return (
			<div data-screen={props.name}>
				<input
					aria-label={`${props.name} input`}
					value={text()}
					onInput={(event) => setText(event.currentTarget.value)}
				/>
				<ChoiceSelect
					aria-label={`${props.name} choice`}
					value={0}
					options={[
						{ value: 0, label: "关闭" },
						{ value: 1, label: "开启" },
					]}
					onChange={changed}
				/>
			</div>
		);
	}
	dispose = render(
		() => (
			<>
				<button data-outside>外部按钮</button>
				<button
					ref={(node) => {
						modeButtons.recording = node;
					}}
					onClick={() => setMode("recording")}
				>
					录屏
				</button>
				<button
					ref={(node) => {
						modeButtons.presentation = node;
					}}
					onClick={() => setMode("presentation")}
				>
					演示
				</button>
				<MotionSwitch
					value={mode()}
					kind="subpage"
					class="mode-switch"
					order={["recording", "presentation"]}
					focusFallback={() => modeButtons[mode()]}
				>
					{(displayedMode) => (
						<>
							<MotionPanel
								visible={displayedMode() === "presentation"}
								testId="presentation"
							>
								<Panel name="presentation" />
							</MotionPanel>
							<MotionPanel
								visible={displayedMode() === "recording"}
								testId="recording"
							>
								<button
									ref={(node) => {
										sourceButtons.desktop = node;
									}}
									onClick={() => setSource("desktop")}
								>
									电脑
								</button>
								<button
									ref={(node) => {
										sourceButtons.mobile = node;
									}}
									onClick={() => setSource("mobile")}
								>
									移动
								</button>
								<MotionSwitch
									value={source()}
									kind="subpage"
									class="source-switch"
									order={["desktop", "mobile"]}
									focusFallback={() => sourceButtons[source()]}
								>
									{(displayedSource) => (
										<>
											<MotionPanel
												visible={displayedSource() === "desktop"}
												testId="desktop"
											>
												<Panel name="desktop" />
											</MotionPanel>
											<MotionPanel
												visible={displayedSource() === "mobile"}
												testId="mobile"
											>
												<Panel name="mobile" />
											</MotionPanel>
										</>
									)}
								</MotionSwitch>
							</MotionPanel>
						</>
					)}
				</MotionSwitch>
			</>
		),
		document.body,
	);
	return {
		setMode,
		setSource,
		mounted,
		removed,
		changed,
		modeButtons,
		sourceButtons,
	};
}
const panel = (name: string) => element(`[data-testid="${name}"]`);
const visiblePanels = (selector: string) =>
	Array.from(element(selector).children).filter(
		(node) =>
			node instanceof HTMLElement &&
			!node.hidden &&
			node.style.display !== "none",
	);

describe.each(["mode", "source"] as const)("persistent %s panels", (kind) => {
	const selector = kind === "mode" ? ".mode-switch" : ".source-switch";
	const first = kind === "mode" ? "recording" : "desktop";
	const second = kind === "mode" ? "presentation" : "mobile";
	const change = (state: ReturnType<typeof mount>, next: boolean) => {
		if (kind === "mode") state.setMode(next ? "presentation" : "recording");
		else state.setSource(next ? "mobile" : "desktop");
	};
	it("retains the outgoing panel until exit and then shows exactly one incoming panel", async () => {
		const state = mount();
		const original = panel(first);
		const incoming = panel(second);
		expect(visiblePanels(selector)).toEqual([original]);
		change(state, true);
		expect(element(selector).inert).toBe(true);
		expect(visiblePanels(selector)).toEqual([original]);
		expect(incoming.getAttribute("aria-hidden")).toBe("true");
		outgoing(selector).resolve();
		await settle();
		expect(visiblePanels(selector)).toEqual([incoming]);
		expect(element(selector).inert).toBe(false);
		expect(original.inert).toBe(true);
		expect(incoming.inert).toBe(false);
	});
	it("ignores an obsolete transition when rapidly reversed", async () => {
		const state = mount();
		change(state, true);
		const obsolete = outgoing(selector);
		change(state, false);
		const latest = outgoing(selector);
		expect(obsolete.cancel).toHaveBeenCalledOnce();
		obsolete.resolve();
		await settle();
		expect(visiblePanels(selector)).toEqual([panel(first)]);
		expect(element(selector).inert).toBe(true);
		latest.resolve();
		await settle();
		expect(visiblePanels(selector)).toEqual([panel(first)]);
		expect(element(selector).inert).toBe(false);
		expect(state.removed).not.toHaveBeenCalled();
	});
	it("moves focus out before the focused panel becomes inactive", async () => {
		const state = mount();
		element('[data-screen="desktop"] input').focus();
		change(state, true);
		const expected =
			kind === "mode"
				? state.modeButtons.presentation
				: state.sourceButtons.mobile;
		expect(document.activeElement).toBe(expected);
		outgoing(selector).resolve();
		await settle();
		expect(document.activeElement).toBe(expected);
	});
	it("keeps outside focus and does not steal it on arrival", async () => {
		const state = mount();
		const outside = element("[data-outside]");
		outside.focus();
		change(state, true);
		outgoing(selector).resolve();
		await settle();
		expect(document.activeElement).toBe(outside);
	});
	it("settles immediately without animation when reduced motion is enabled", () => {
		reduce = true;
		const state = mount();
		change(state, true);
		expect(visiblePanels(selector)).toEqual([panel(second)]);
		expect(element(selector).inert).toBe(false);
		expect(animations).toHaveLength(0);
	});
});

it("preserves panel instances, edited input and scroll position across both switches", async () => {
	const state = mount();
	const input = element('[data-screen="desktop"] input') as HTMLInputElement;
	input.value = "保留我的设置";
	input.dispatchEvent(new Event("input", { bubbles: true }));
	const desktop = panel("desktop");
	desktop.scrollTop = 47;
	state.setSource("mobile");
	outgoing(".source-switch").resolve();
	await settle();
	state.setMode("presentation");
	outgoing(".mode-switch").resolve();
	await settle();
	state.setMode("recording");
	outgoing(".mode-switch").resolve();
	await settle();
	expect(visiblePanels(".source-switch")).toEqual([panel("mobile")]);
	state.setSource("desktop");
	outgoing(".source-switch").resolve();
	await settle();
	expect(element('[data-screen="desktop"] input')).toBe(input);
	expect(input.value).toBe("保留我的设置");
	expect(desktop.scrollTop).toBe(47);
	expect(state.mounted.mock.calls).toEqual([
		["presentation"],
		["desktop"],
		["mobile"],
	]);
	expect(state.removed).not.toHaveBeenCalled();
});

it("keeps nested controls disabled until their own panel and ancestor are both active", async () => {
	const state = mount();
	const choice = (name: string) =>
		element(`[aria-label="${name} choice"]`) as HTMLButtonElement;
	expect(choice("desktop").disabled).toBe(false);
	expect(choice("mobile").disabled).toBe(true);
	expect(choice("presentation").disabled).toBe(true);
	state.setSource("mobile");
	expect(choice("desktop").disabled).toBe(true);
	outgoing(".source-switch").resolve();
	await settle();
	expect(choice("mobile").disabled).toBe(false);
	state.setMode("presentation");
	expect(choice("mobile").disabled).toBe(true);
	outgoing(".mode-switch").resolve();
	await settle();
	expect(choice("presentation").disabled).toBe(false);
	expect(choice("desktop").disabled).toBe(true);
	expect(choice("mobile").disabled).toBe(true);
	state.setMode("recording");
	outgoing(".mode-switch").resolve();
	await settle();
	expect(choice("mobile").disabled).toBe(false);
	expect(choice("presentation").disabled).toBe(true);
});

it("blurs outgoing focus when the fallback button has become disabled", () => {
	const state = mount();
	const input = element('[data-screen="desktop"] input');
	input.focus();
	required(state.modeButtons.presentation).disabled = true;
	state.setMode("presentation");
	expect(document.activeElement).not.toBe(input);
	expect(document.activeElement).not.toBe(state.modeButtons.presentation);
});

it("cancels a portal menu as soon as its persistent heading starts hiding", async () => {
	const [shown, setShown] = createSignal(true);
	const changed = vi.fn();
	dispose = render(
		() => (
			<MotionPresence visible={shown()}>
				<ChoiceSelect
					aria-label="heading choice"
					value={0}
					options={[
						{ value: 0, label: "关闭" },
						{ value: 1, label: "开启" },
					]}
					onChange={changed}
				/>
			</MotionPresence>
		),
		document.body,
	);
	const trigger = element('[aria-label="heading choice"]') as HTMLButtonElement;
	trigger.click();
	await settle();
	expect(trigger.getAttribute("aria-expanded")).toBe("true");
	setShown(false);
	await settle();
	expect(trigger.disabled).toBe(true);
	expect(trigger.getAttribute("aria-expanded")).toBe("false");
	expect(document.querySelector('[role="listbox"]')).toBeNull();
	expect(changed).not.toHaveBeenCalled();
	outgoing(".jk-motion-presence").resolve();
	await settle();
	expect(element(".jk-motion-presence").style.display).toBe("none");
});

it.each(["mode", "source"] as const)(
	"closes a portal menu on %s exit without changing values or returning focus to hidden content",
	async (kind) => {
		const state = mount();
		const trigger = element(
			'[aria-label="desktop choice"]',
		) as HTMLButtonElement;
		trigger.click();
		await settle();
		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		if (kind === "mode") state.setMode("presentation");
		else state.setSource("mobile");
		await settle();
		expect(trigger.disabled).toBe(true);
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		expect(document.querySelector('[role="listbox"]')).toBeNull();
		expect(state.changed).not.toHaveBeenCalled();
		outgoing(kind === "mode" ? ".mode-switch" : ".source-switch").resolve();
		await settle();
		expect(document.activeElement).not.toBe(trigger);
		trigger.click();
		await settle();
		expect(document.querySelector('[role="listbox"]')).toBeNull();
	},
);

it.each(["reduce", "hidden"] as const)(
	"cancels in-flight transitions when the page becomes %s",
	async (setting) => {
		const state = mount();
		state.setMode("presentation");
		const obsolete = outgoing(".mode-switch");
		if (setting === "reduce") {
			reduce = true;
			media.dispatchEvent(new Event("change"));
		} else {
			Object.defineProperty(document, "visibilityState", {
				configurable: true,
				value: "hidden",
			});
			document.dispatchEvent(new Event("visibilitychange"));
		}
		expect(obsolete.cancel).toHaveBeenCalledOnce();
		expect(visiblePanels(".mode-switch")).toEqual([panel("presentation")]);
		expect(element(".mode-switch").inert).toBe(false);
		obsolete.resolve();
		await settle();
		expect(visiblePanels(".mode-switch")).toEqual([panel("presentation")]);
	},
);

it("does not resurrect a panel after disposing an in-flight transition", async () => {
	const state = mount();
	state.setMode("presentation");
	const obsolete = outgoing(".mode-switch");
	const count = animations.length;
	dispose?.();
	dispose = undefined;
	obsolete.resolve();
	await settle();
	expect(document.querySelector(".mode-switch")).toBeNull();
	expect(animations).toHaveLength(count);
	expect(state.removed).toHaveBeenCalledTimes(3);
});
