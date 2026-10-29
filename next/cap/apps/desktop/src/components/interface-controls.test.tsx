import { createSignal, type ValidComponent } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setInterfaceLanguage } from "~/utils/i18n";
import { motionGlyphs } from "~/utils/interface-motion-tokens";
import { type ChoiceOption, ChoiceSelect } from "./ChoiceSelect";
import { Disclosure } from "./Disclosure";
import { MotionSwitch } from "./InterfaceMotion";
import { LocalizedChoiceSelect } from "./LocalizedChoiceSelect";
import { MotionText } from "./MotionText";

vi.mock("~/store", () => ({ languageStore: { set: vi.fn(async () => {}) } }));

vi.mock("~/routes/editor/ui", async () => {
	const { Polymorphic } = await import("@kobalte/core/polymorphic");
	const wrapper = (props: Record<string, unknown> & { as: ValidComponent }) => (
		<Polymorphic {...props} />
	);
	return { MenuItem: wrapper, MenuItemList: wrapper, PopperContent: wrapper };
});
function required<T extends Element>(node: T | null | undefined): T {
	if (!node) throw new Error("Expected UI element");
	return node;
}

let dispose: (() => void) | undefined;
const animations: { cancel: ReturnType<typeof vi.fn>; resolve: () => void }[] =
	[];
const settle = async () => {
	await new Promise((resolve) => setTimeout(resolve, 30));
};
const press = (node: HTMLElement) =>
	node.dispatchEvent(
		new MouseEvent("pointerdown", { button: 0, bubbles: true }),
	);
const key = (node: Element, value: string) =>
	node.dispatchEvent(
		new KeyboardEvent("keydown", { key: value, bubbles: true }),
	);
beforeEach(async () => {
	await setInterfaceLanguage("zh-CN");
	const style = document.createElement("style");
	style.textContent = "* { animation-name: none; }";
	document.head.append(style);
	Object.defineProperty(document, "visibilityState", {
		configurable: true,
		value: "visible",
	});
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		value: vi.fn(() => ({
			matches: false,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		})),
	});
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	Element.prototype.scrollIntoView = vi.fn();
	Element.prototype.animate = () => {
		let resolve!: () => void;
		const finished = new Promise<void>((done) => {
			resolve = done;
		});
		const cancel = vi.fn(resolve);
		animations.push({ cancel, resolve });
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
function mount(
	options: readonly ChoiceOption[] = [
		{ value: 0, label: "关闭" },
		{ value: 1, label: "开启" },
	],
) {
	const [value, setValue] = createSignal<string | number>(0);
	const [disabled, setDisabled] = createSignal(false);
	const [items, setItems] = createSignal(options);
	const changed = vi.fn((next: string) => setValue(next));
	dispose = render(
		() => (
			<ChoiceSelect
				aria-label="效果"
				value={value()}
				disabled={disabled()}
				options={items()}
				onChange={changed}
			/>
		),
		document.body,
	);
	return {
		trigger: required(document.querySelector<HTMLButtonElement>("button")),
		value,
		setDisabled,
		setItems,
		changed,
	};
}
describe("shared choice controls", () => {
	it("opens through assistive click activation", async () => {
		const { trigger, changed } = mount();
		trigger.click();
		await settle();
		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		expect(changed).not.toHaveBeenCalled();
	});

	it("keeps numeric zero selected without changing on open", async () => {
		const { trigger, changed } = mount();
		expect(trigger.getAttribute("aria-label")).toBe("效果");
		expect(trigger.textContent).toContain("关闭");
		press(trigger);
		await settle();
		expect(document.querySelectorAll('[role="option"]').length).toBe(2);
		expect(changed).not.toHaveBeenCalled();
	});
	it("selects with the keyboard and returns focus", async () => {
		const { trigger, value } = mount();
		trigger.focus();
		key(trigger, "ArrowDown");
		await settle();
		const list = required(document.querySelector('[role="listbox"]'));
		key(list, "ArrowDown");
		await settle();
		key(required(document.activeElement), "Enter");
		await settle();
		expect(value()).toBe("1");
		expect(document.activeElement).toBe(trigger);
	});
	it("cancels with Escape without changing", async () => {
		const { trigger, changed } = mount();
		trigger.focus();
		press(trigger);
		await settle();
		key(required(document.querySelector('[role="listbox"]')), "Escape");
		await settle();
		expect(changed).not.toHaveBeenCalled();
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
	});
	it("refreshes dynamic device labels", async () => {
		const { trigger, setItems } = mount();
		setItems([{ value: 0, label: "我的 iPad · 001" }]);
		await settle();
		expect(trigger.textContent).toContain("我的 iPad · 001");
		press(trigger);
		await settle();
		expect(document.querySelector('[role="option"]')?.textContent).toContain(
			"我的 iPad · 001",
		);
	});
	it("does not open disabled controls", async () => {
		const { trigger, setDisabled } = mount();
		setDisabled(true);
		press(trigger);
		await settle();
		expect(trigger.disabled).toBe(true);
		expect(document.querySelector('[role="listbox"]')).toBeNull();
	});
	it("closes a menu when its parent fieldset becomes disabled", async () => {
		const fieldset = document.createElement("fieldset");
		document.body.append(fieldset);
		dispose = render(
			() => (
				<ChoiceSelect
					value={0}
					options={[{ value: 0, label: "关闭" }]}
					onChange={vi.fn()}
				/>
			),
			fieldset,
		);
		const trigger = required(fieldset.querySelector("button"));
		press(trigger);
		await settle();
		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		fieldset.disabled = true;
		await settle();
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
	});
	it("does not select an unauthorized device", async () => {
		const { trigger, changed } = mount([
			{ value: 0, label: "请选择" },
			{ value: "android:1", label: "未授权手机", disabled: true },
		]);
		press(trigger);
		await settle();
		const item = required(
			Array.from(
				document.querySelectorAll<HTMLElement>('[role="option"]'),
			).find((node) => node.textContent?.includes("未授权手机")),
		);
		item.click();
		await settle();
		expect(changed).not.toHaveBeenCalled();
	});
});
describe("changing text", () => {
	it("preserves grapheme clusters and bounds long text work", () => {
		expect(motionGlyphs("中👩‍💻é文")).toEqual(["中", "👩‍💻", "é", "文"]);
		const long = "这是一条较长的说明文字".repeat(5);
		expect(motionGlyphs(long)).toEqual([long]);
	});
	it("cancels obsolete animation on rapid changes and cleanup", async () => {
		const [text, setText] = createSignal("旧选项");
		dispose = render(() => <MotionText text={text()} />, document.body);
		setText("新选项");
		await settle();
		const first = [...animations];
		expect(first.length).toBeGreaterThan(0);
		setText("最终选择");
		await settle();
		expect(
			first.every((animation) => animation.cancel.mock.calls.length > 0),
		).toBe(true);
		expect(
			document.querySelector(".jk-motion-text")?.getAttribute("aria-label"),
		).toBe("最终选择");
		dispose();
		dispose = undefined;
		expect(
			animations.every((animation) => animation.cancel.mock.calls.length > 0),
		).toBe(true);
	});
});

it("shows text immediately with reduced motion", async () => {
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		value: () => ({
			matches: true,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		}),
	});
	const [text, setText] = createSignal("旧文字");
	dispose = render(() => <MotionText text={text()} />, document.body);
	setText("新文字");
	await settle();
	expect(animations.length).toBe(0);
	expect(
		document.querySelector(".jk-motion-text")?.getAttribute("aria-label"),
	).toBe("新文字");
});

it("keeps only the latest page after rapid reversal", async () => {
	const [page, setPage] = createSignal("first");
	dispose = render(
		() => (
			<MotionSwitch value={page()}>
				{(current) => <div>{current()}</div>}
			</MotionSwitch>
		),
		document.body,
	);
	setPage("second");
	setPage("third");
	const latest = animations.at(-1);
	expect(latest).toBeDefined();
	latest?.resolve();
	await settle();
	expect(document.body.textContent).toBe("third");
	expect(document.querySelector<HTMLElement>(".jk-motion-content")?.inert).toBe(
		false,
	);
});
it("expands and collapses shared detail sections", async () => {
	dispose = render(
		() => (
			<Disclosure title="阴影细节">
				<div>柔化</div>
			</Disclosure>
		),
		document.body,
	);
	const trigger = required(document.querySelector("button"));
	trigger.click();
	await settle();
	expect(trigger.getAttribute("aria-expanded")).toBe("true");
	expect(document.body.textContent).toContain("柔化");
	trigger.click();
	await settle();
	expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

describe("localized shared choices", () => {
	it("updates option labels on language changes without writing a new value", async () => {
		const changed = vi.fn();
		dispose = render(
			() => (
				<LocalizedChoiceSelect
					value="all"
					options={[
						{ value: "all", label: "Match all" },
						{ value: "any", label: "Match any" },
					]}
					onChange={changed}
				/>
			),
			document.body,
		);
		const trigger = required(document.querySelector("button"));
		expect(trigger.textContent).toContain("满足全部条件");
		await setInterfaceLanguage("en");
		await settle();
		expect(trigger.textContent).toContain("Match all");
		await setInterfaceLanguage("zh-CN");
		await settle();
		expect(trigger.textContent).toContain("满足全部条件");
		press(trigger);
		await settle();
		expect(document.body.textContent).toContain("满足任一条件");
		expect(changed).not.toHaveBeenCalled();
	});
	it("preserves preset names even when they match a translation key", async () => {
		dispose = render(
			() => (
				<LocalizedChoiceSelect
					preserveLabels
					value="Match all"
					options={[{ value: "Match all", label: "Match all" }]}
					onChange={vi.fn()}
				/>
			),
			document.body,
		);
		expect(document.querySelector("button")?.textContent).toContain(
			"Match all",
		);
		expect(document.querySelector("button")?.textContent).not.toContain(
			"满足全部条件",
		);
	});
	it("keeps an unknown saved value visible until an explicit replacement", async () => {
		const [value, setValue] = createSignal("120");
		const changed = vi.fn(setValue);
		dispose = render(
			() => (
				<LocalizedChoiceSelect
					value={value()}
					options={[
						{ value: "30", label: "30 FPS" },
						{ value: "60", label: "60 FPS" },
					]}
					onChange={changed}
				/>
			),
			document.body,
		);
		const trigger = required(document.querySelector("button"));
		expect(trigger.textContent).toContain("120");
		press(trigger);
		await settle();
		key(required(document.querySelector('[role="listbox"]')), "ArrowDown");
		await settle();
		key(required(document.activeElement), "Enter");
		await settle();
		expect(changed).toHaveBeenCalledWith("30");
		expect(value()).toBe("30");
	});
});
