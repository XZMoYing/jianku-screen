import {
	type Accessor,
	createContext,
	createEffect,
	createSignal,
	type JSX,
	on,
	onCleanup,
	onMount,
	useContext,
} from "solid-js";
import { interfaceMotion } from "~/utils/interface-motion-tokens";
import { InterfaceSpring, springFrames } from "~/utils/interface-spring";

const arrivalFrames = (kind: "page" | "subpage", direction: number) =>
	springFrames(
		interfaceMotion[kind].response,
		interfaceMotion[kind].damping,
		interfaceMotion[kind].duration / 1000,
	).map(({ offset, progress }) => ({
		offset,
		opacity: Math.min(1, Math.max(0, progress * 1.9)),
		transform:
			kind === "page"
				? `translate3d(0, ${(interfaceMotion.page.travel * (1 - progress)).toFixed(2)}px, 0) scale(${(0.985 + 0.015 * progress).toFixed(4)})`
				: `translate3d(${(direction * interfaceMotion.subpage.travel * (1 - progress)).toFixed(2)}px, ${(6 * (1 - progress)).toFixed(2)}px, 0) scale(${(0.988 + 0.012 * progress).toFixed(4)})`,
		...(kind === "page"
			? {
					filter: `blur(${(2.2 * Math.max(0, 1 - progress * 1.4)).toFixed(2)}px)`,
				}
			: {}),
	}));
const enterFrames = arrivalFrames("page", 1);
const pageArrivals = {
	page: enterFrames,
	forward: arrivalFrames("subpage", 1),
	backward: arrivalFrames("subpage", -1),
};
const sectionFrames = springFrames(
	interfaceMotion.section.response,
	interfaceMotion.section.damping,
	interfaceMotion.section.duration / 1000,
).map(({ offset, progress }) => ({
	offset,
	opacity: Math.min(1, Math.max(0, progress * 1.7)),
	transform: `translate3d(0, ${(interfaceMotion.section.travel * (1 - progress)).toFixed(2)}px, 0) scale(${(0.975 + 0.025 * progress).toFixed(4)})`,
}));
const reducedMotion = () =>
	document.visibilityState !== "visible" ||
	window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const MotionInteractionContext = createContext<Accessor<boolean>>(() => true);
export const useMotionInteraction = () => useContext(MotionInteractionContext);

const ACTIVE_TAB_SELECTOR =
	"button[aria-pressed=true], button[aria-selected=true], button[data-selected], a[aria-current=page]";
const TAB_ITEM_SELECTOR = "button, a";

/**
 * Predicts the final post-transition rect of `selected` inside a horizontal
 * MotionGroup whose buttons have collapsible `.jk-tab-label` spans. Reading
 * live `offsetLeft`/`offsetWidth` while CSS `max-width` is still transitioning
 * causes asymmetric left-vs-right overshoot (collapsing a left sibling pulls
 * `offsetLeft` backward mid-flight while expanding a left target does not).
 * Computing the settled target on frame 0 gives symmetric spring rebound in
 * both directions without cancelling the live CSS label reveal.
 */
function measureSettledTarget(root: HTMLElement, selected: HTMLElement) {
	const buttons = Array.from(
		root.querySelectorAll<HTMLElement>(TAB_ITEM_SELECTOR),
	).filter(
		(el) =>
			el.closest(".jk-motion-group") === root &&
			el.offsetWidth > 0 &&
			el.offsetHeight > 0,
	);
	const hasCollapsibleLabels = buttons.some(
		(button) => button.querySelector(".jk-tab-label") !== null,
	);
	if (!hasCollapsibleLabels || buttons.length === 0) {
		return {
			x: selected.offsetLeft,
			y: selected.offsetTop,
			width: selected.offsetWidth,
			height: selected.offsetHeight,
			collapsible: false,
		};
	}

	const rootStyle = getComputedStyle(root);
	if (rootStyle.flexDirection.startsWith("column")) {
		return {
			x: selected.offsetLeft,
			y: selected.offsetTop,
			width: selected.offsetWidth,
			height: selected.offsetHeight,
			collapsible: false,
		};
	}

	const gap = Number.parseFloat(rootStyle.columnGap || rootStyle.gap) || 0;
	const padLeft = Number.parseFloat(rootStyle.paddingLeft) || 0;
	const padRight = Number.parseFloat(rootStyle.paddingRight) || 0;

	const settledWidths = buttons.map((button) => {
		const style = getComputedStyle(button);
		const btnPadX =
			(Number.parseFloat(style.paddingLeft) || 0) +
			(Number.parseFloat(style.paddingRight) || 0);
		const minW = Number.parseFloat(style.minWidth) || 0;
		const icon = button.querySelector<SVGElement>(":scope > svg");
		const iconW = icon ? icon.getBoundingClientRect().width || 16 : 0;
		const label = button.querySelector<HTMLElement>(":scope > .jk-tab-label");
		const isSelected = button === selected;
		if (!isSelected || !label) {
			return Math.max(minW, Math.ceil(btnPadX + iconW));
		}
		const labelStyle = getComputedStyle(label);
		const labelGap =
			(Number.parseFloat(style.columnGap || style.gap) || 0) +
			(Number.parseFloat(labelStyle.marginLeft) || 0) +
			(Number.parseFloat(labelStyle.marginRight) || 0);
		const activeMargin = labelGap > 0 ? labelGap : 6;
		const labelNaturalW = Math.min(Math.ceil(label.scrollWidth), 88);
		return Math.max(
			minW,
			Math.ceil(btnPadX + iconW + activeMargin + labelNaturalW),
		);
	});

	const totalSettledW =
		settledWidths.reduce((sum, w) => sum + w, 0) +
		gap * Math.max(0, buttons.length - 1);
	const currentTotalW =
		buttons.reduce((sum, b) => sum + b.offsetWidth, 0) +
		gap * Math.max(0, buttons.length - 1);
	const isFitContent =
		Math.abs(root.clientWidth - (currentTotalW + padLeft + padRight)) < 3;
	const isCentered = rootStyle.justifyContent === "center";
	const startX =
		isCentered && !isFitContent
			? Math.max(padLeft, (root.clientWidth - totalSettledW) / 2)
			: padLeft;

	const selectedIndex = buttons.indexOf(selected);
	let offsetX = startX;
	for (let i = 0; i < selectedIndex; i++) {
		offsetX += settledWidths[i] + gap;
	}
	return {
		x: offsetX,
		y: selected.offsetTop,
		width: settledWidths[selectedIndex] ?? selected.offsetWidth,
		height: selected.offsetHeight,
		collapsible: true,
	};
}

export function MotionGroup(props: {
	class: string;
	label: string;
	children: JSX.Element;
}) {
	let root!: HTMLDivElement;
	let pill!: HTMLSpanElement;
	let frame = 0;
	let x: InterfaceSpring | undefined;
	let width: InterfaceSpring | undefined;
	let y: InterfaceSpring | undefined;
	let height: InterfaceSpring | undefined;
	let lastSelected: HTMLElement | undefined;
	let lastRootWidth = 0;
	let tabTransitionUntil = 0;
	let settleTimer: ReturnType<typeof setTimeout> | undefined;

	const tick = (time: number) => {
		frame = 0;
		if (!x || !width || !y || !height) return;
		const position = x.read(time);
		const size = width.read(time);
		const vertical = y.read(time);
		const tall = height.read(time);

		const velocity = Math.hypot(position.velocity, vertical.velocity);
		const stretch = reducedMotion() ? 0 : Math.min(velocity / 1350, 0.075);
		const sx = 1 + stretch;
		const sy = 1 - stretch * 0.42;

		const settled =
			Math.abs(position.value - x.target) +
				Math.abs(size.value - width.target) +
				Math.abs(vertical.value - y.target) +
				Math.abs(tall.value - height.target) <=
				0.08 &&
			Math.abs(position.velocity) +
				Math.abs(size.velocity) +
				Math.abs(vertical.velocity) +
				Math.abs(tall.velocity) <=
				0.35;

		if (settled) {
			pill.style.transform = `translate3d(${x.target.toFixed(2)}px, ${y.target.toFixed(2)}px, 0)`;
			pill.style.width = `${width.target.toFixed(2)}px`;
			pill.style.height = `${height.target.toFixed(2)}px`;
			pill.classList.remove("is-moving");
		} else {
			pill.style.transform = `translate3d(${position.value.toFixed(2)}px, ${vertical.value.toFixed(2)}px, 0) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
			pill.style.width = `${Math.max(0, size.value).toFixed(2)}px`;
			pill.style.height = `${Math.max(0, tall.value).toFixed(2)}px`;
			pill.classList.add("is-moving");
			frame = requestAnimationFrame(tick);
		}
	};

	const findSelected = () =>
		Array.from(root.querySelectorAll<HTMLElement>(ACTIVE_TAB_SELECTOR)).find(
			(button) => button.closest(".jk-motion-group") === root,
		);

	const retargetTo = (
		tx: number,
		ty: number,
		tw: number,
		th: number,
		instant: boolean,
	) => {
		const { response, damping } = interfaceMotion.selection;
		const now = performance.now();
		if (!x || !width || !y || !height || instant || reducedMotion()) {
			x = new InterfaceSpring(tx);
			width = new InterfaceSpring(tw);
			y = new InterfaceSpring(ty);
			height = new InterfaceSpring(th);
			pill.style.opacity = "1";
			pill.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0)`;
			pill.style.width = `${tw.toFixed(2)}px`;
			pill.style.height = `${th.toFixed(2)}px`;
			pill.classList.remove("is-moving");
			return;
		}
		x.retarget(tx, now, response, damping);
		width.retarget(tw, now, response, damping);
		y.retarget(ty, now, response, damping);
		height.retarget(th, now, response, damping);
		pill.style.opacity = "1";
		frame ||= requestAnimationFrame(tick);
	};

	const update = (fromResize = false) => {
		const selected = findSelected();
		if (!selected || !selected.offsetWidth) return;
		const now = performance.now();
		const selectionChanged = selected !== lastSelected;
		const rootResized =
			lastRootWidth > 0 && Math.abs(root.clientWidth - lastRootWidth) > 2;

		// Ignore intermediate ResizeObserver frames fired while collapsible
		// `.jk-tab-label` widths are transitioning; only retarget on actual
		// selection changes or genuine container width changes.
		if (
			fromResize &&
			!selectionChanged &&
			!rootResized &&
			now < tabTransitionUntil
		) {
			return;
		}

		lastRootWidth = root.clientWidth;

		if (!x || !width || !lastSelected) {
			lastSelected = selected;
			retargetTo(
				selected.offsetLeft,
				selected.offsetTop,
				selected.offsetWidth,
				selected.offsetHeight,
				true,
			);
			return;
		}

		if (selectionChanged) {
			lastSelected = selected;
			const predicted = measureSettledTarget(root, selected);
			if (predicted.collapsible) {
				tabTransitionUntil = now + 620;
				if (settleTimer) clearTimeout(settleTimer);
				settleTimer = setTimeout(() => {
					settleTimer = undefined;
					const current = findSelected();
					if (!current || current !== lastSelected || !current.offsetWidth)
						return;
					if (
						!x ||
						!width ||
						Math.abs(current.offsetLeft - x.target) > 0.75 ||
						Math.abs(current.offsetWidth - width.target) > 0.75
					) {
						retargetTo(
							current.offsetLeft,
							current.offsetTop,
							current.offsetWidth,
							current.offsetHeight,
							false,
						);
					}
				}, 640);
			}
			retargetTo(
				predicted.x,
				predicted.y,
				predicted.width,
				predicted.height,
				false,
			);
			return;
		}

		if (
			Math.abs(selected.offsetLeft - x.target) > 0.5 ||
			Math.abs(selected.offsetTop - (y?.target ?? 0)) > 0.5 ||
			Math.abs(selected.offsetWidth - width.target) > 0.5 ||
			Math.abs(selected.offsetHeight - (height?.target ?? 0)) > 0.5
		) {
			retargetTo(
				selected.offsetLeft,
				selected.offsetTop,
				selected.offsetWidth,
				selected.offsetHeight,
				false,
			);
		}
	};

	onMount(() => {
		const changes = new MutationObserver(() => update(false));
		changes.observe(root, {
			subtree: true,
			attributes: true,
			attributeFilter: [
				"aria-pressed",
				"aria-selected",
				"aria-current",
				"data-selected",
			],
		});
		const size = new ResizeObserver(() => update(true));
		size.observe(root);
		for (const button of root.querySelectorAll(TAB_ITEM_SELECTOR))
			size.observe(button);
		update(false);
		onCleanup(() => {
			if (settleTimer) clearTimeout(settleTimer);
			changes.disconnect();
			size.disconnect();
			cancelAnimationFrame(frame);
		});
	});
	return (
		<div
			ref={root}
			class={`${props.class} jk-motion-group`}
			role="group"
			aria-label={props.label}
		>
			<span ref={pill} class="jk-selection-pill" aria-hidden="true" />
			{props.children}
		</div>
	);
}

export function MotionSwitch<T>(props: {
	value: T;
	kind?: "page" | "subpage";
	order?: readonly T[];
	direction?: 1 | -1;
	class?: string;
	focusFallback?: () => HTMLElement | undefined;
	children: (value: Accessor<T>) => JSX.Element;
}) {
	const [displayed, setDisplayed] = createSignal(props.value);
	const [interactive, setInteractive] = createSignal(true);
	const parentInteractive = useMotionInteraction();
	let root!: HTMLDivElement;
	let revision = 0;
	let animations: Animation[] = [];
	const cancel = () => {
		for (const animation of animations) animation.cancel();
		animations = [];
	};
	createEffect(
		on(
			() => props.value,
			async (value) => {
				const generation = ++revision;
				const kind = props.kind ?? "page";
				const direction =
					props.direction ??
					(!props.order ||
					props.order.indexOf(value) >= props.order.indexOf(displayed())
						? 1
						: -1);
				const opacity = getComputedStyle(root).opacity;
				const transform = getComputedStyle(root).transform;
				cancel();
				const focused = document.activeElement;
				root.inert = true;
				setInteractive(false);
				if (focused instanceof HTMLElement && root.contains(focused)) {
					const fallback = props.focusFallback?.();
					if (
						fallback &&
						!fallback.matches(":disabled") &&
						!root.contains(fallback)
					)
						fallback.focus({ preventScroll: true });
					else focused.blur();
				}
				if (!reducedMotion()) {
					const exit = root.animate(
						[
							kind === "page"
								? { opacity, transform, filter: "blur(0px)" }
								: { opacity, transform },
							kind === "page"
								? {
										opacity: 0,
										transform: "translate3d(0, 12px, 0) scale(.986)",
										filter: "blur(2.5px)",
									}
								: {
										opacity: 0,
										transform: `translate3d(${-direction * 14}px, 3px, 0) scale(.988)`,
									},
						],
						{
							duration: interfaceMotion.outgoing.duration,
							easing: interfaceMotion.outgoing.easing,
							fill: "forwards",
						},
					);
					animations.push(exit);
					await exit.finished.catch(() => {});
				}
				if (generation !== revision) return;
				setDisplayed(() => value);
				if (!reducedMotion())
					await new Promise<void>((resolve) =>
						requestAnimationFrame(() => resolve()),
					);
				if (generation !== revision) return;
				const sections: Array<{ element: HTMLElement; delay: number }> = [];
				if (kind === "page" && !reducedMotion()) {
					const bounds = root.getBoundingClientRect();
					const candidates = Array.from(
						root.querySelectorAll<HTMLElement>(
							"[data-motion-section], [role=tabpanel]:not([hidden]) > div, .jk-motion-content > .jk-layout-settings, .jk-motion-content > .jk-cursor-settings, .jk-motion-content > .jk-background-settings",
						),
					);
					const selected = new Set(candidates);
					for (const element of candidates) {
						let ancestor = element.parentElement;
						let nested = false;
						while (ancestor && ancestor !== root) {
							if (selected.has(ancestor)) {
								nested = true;
								break;
							}
							ancestor = ancestor.parentElement;
						}
						if (nested) continue;
						const rect = element.getBoundingClientRect();
						if (!rect.height) continue;
						sections.push({
							element,
							delay:
								(Math.min(720, Math.max(0, rect.top - bounds.top)) / 720) * 180,
						});
					}
				}
				cancel();
				root.inert = false;
				setInteractive(true);
				if (reducedMotion()) return;
				animations.push(
					root.animate(
						kind === "page"
							? pageArrivals.page
							: direction > 0
								? pageArrivals.forward
								: pageArrivals.backward,
						{
							duration: interfaceMotion[kind].duration,
							easing: "linear",
						},
					),
				);
				if (kind === "page") {
					for (const { element, delay } of sections) {
						animations.push(
							element.animate(sectionFrames, {
								duration: interfaceMotion.section.duration,
								delay,
								easing: "linear",
								fill: "backwards",
							}),
						);
					}
				}
			},
			{ defer: true },
		),
	);
	onMount(() => {
		const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
		const settle = () => {
			revision++;
			cancel();
			setDisplayed(() => props.value);
			root.inert = false;
			setInteractive(true);
		};
		reduced.addEventListener("change", settle);
		document.addEventListener("visibilitychange", settle);
		onCleanup(() => {
			reduced.removeEventListener("change", settle);
			document.removeEventListener("visibilitychange", settle);
		});
	});
	onCleanup(() => {
		revision++;
		cancel();
		root.inert = false;
	});
	return (
		<div
			ref={root}
			class={`jk-motion-content ${props.class ?? ""}`}
			data-motion-kind={props.kind ?? "page"}
		>
			<MotionInteractionContext.Provider
				value={() => parentInteractive() && interactive()}
			>
				{props.children(displayed)}
			</MotionInteractionContext.Provider>
		</div>
	);
}

export function MotionPanel(props: {
	visible: boolean;
	class?: string;
	testId?: string;
	children: JSX.Element;
}) {
	const parentInteractive = useMotionInteraction();
	return (
		<div
			class={`jk-motion-panel ${props.class ?? ""}`}
			data-testid={props.testId}
			hidden={!props.visible}
			inert={!props.visible}
			aria-hidden={!props.visible}
			style={{ display: props.visible ? "flex" : "none" }}
		>
			<MotionInteractionContext.Provider
				value={() => parentInteractive() && props.visible}
			>
				{props.children}
			</MotionInteractionContext.Provider>
		</div>
	);
}

export function MotionPresence(props: {
	visible: boolean;
	class?: string;
	testId?: string;
	children: JSX.Element;
}) {
	const [shown, setShown] = createSignal(props.visible);
	const parentInteractive = useMotionInteraction();
	let root!: HTMLDivElement;
	let animation: Animation | undefined;
	let revision = 0;
	createEffect(
		on(
			() => props.visible,
			async (visible) => {
				const generation = ++revision;
				const opacity = getComputedStyle(root).opacity;
				animation?.cancel();
				if (visible) {
					setShown(true);
					if (!reducedMotion())
						animation = root.animate(enterFrames, {
							duration: interfaceMotion.page.duration,
							delay: 90,
							fill: "backwards",
							easing: "linear",
						});
				} else {
					if (!reducedMotion()) {
						animation = root.animate(
							[
								{ opacity, filter: "blur(0px)" },
								{
									opacity: 0,
									transform: "translate3d(0, 12px, 0) scale(.986)",
									filter: "blur(2.5px)",
								},
							],
							{
								duration: interfaceMotion.outgoing.duration,
								easing: interfaceMotion.outgoing.easing,
								fill: "forwards",
							},
						);
						await animation.finished.catch(() => {});
					}
					if (generation === revision) {
						setShown(false);
						animation?.cancel();
					}
				}
			},
			{ defer: true },
		),
	);
	onCleanup(() => {
		revision++;
		animation?.cancel();
	});
	return (
		<div
			ref={root}
			class={`jk-motion-presence ${props.class ?? ""}`}
			data-testid={props.testId}
			style={{ display: shown() ? "flex" : "none" }}
			aria-hidden={!props.visible}
			inert={!props.visible}
		>
			<MotionInteractionContext.Provider
				value={() => parentInteractive() && props.visible}
			>
				{props.children}
			</MotionInteractionContext.Provider>
		</div>
	);
}

const pageChanges = new WeakMap<
	HTMLElement,
	{ revision: number; animation?: Animation }
>();
export async function transitionContent(
	root: HTMLElement,
	change: () => void,
	direction = 1,
) {
	const opacity = getComputedStyle(root).opacity;
	const transform = getComputedStyle(root).transform;
	const previous = pageChanges.get(root);
	const revision = (previous?.revision ?? 0) + 1;
	previous?.animation?.cancel();
	if (reducedMotion()) {
		pageChanges.set(root, { revision });
		change();
		return;
	}
	const exit = root.animate(
		[
			{ opacity, transform, filter: "blur(0px)" },
			{
				opacity: 0,
				transform: `translate3d(${-direction * 16}px, 4px, 0) scale(.986)`,
				filter: "blur(2.5px)",
			},
		],
		{
			duration: interfaceMotion.outgoing.duration,
			easing: interfaceMotion.outgoing.easing,
			fill: "forwards",
		},
	);
	pageChanges.set(root, { revision, animation: exit });
	await exit.finished.catch(() => {});
	if (pageChanges.get(root)?.revision !== revision) return;
	exit.cancel();
	change();
	const enter = root.animate(
		direction > 0 ? pageArrivals.forward : pageArrivals.backward,
		{
			duration: interfaceMotion.subpage.duration,
			easing: "linear",
		},
	);
	pageChanges.set(root, { revision, animation: enter });
}
