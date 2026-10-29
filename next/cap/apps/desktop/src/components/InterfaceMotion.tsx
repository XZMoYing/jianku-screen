import {
	type Accessor,
	createEffect,
	createSignal,
	type JSX,
	on,
	onCleanup,
	onMount,
} from "solid-js";
import { interfaceMotion } from "~/utils/interface-motion-tokens";
import { InterfaceSpring, springFrames } from "~/utils/interface-spring";

const arrivalFrames = (kind: "page" | "subpage", direction: number) =>
	springFrames(
		interfaceMotion[kind].response,
		interfaceMotion[kind].damping,
		0.7,
	).map(({ offset, progress }) => ({
		offset,
		opacity: Math.min(1, Math.max(0, progress)),
		transform:
			kind === "page"
				? `translateY(${14 * (1 - progress)}px)`
				: `translateX(${direction * 26 * (1 - progress)}px) scale(${0.985 + 0.015 * progress})`,
	}));
const enterFrames = arrivalFrames("page", 1);
const reducedMotion = () =>
	document.visibilityState !== "visible" ||
	window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
	const tick = (time: number) => {
		frame = 0;
		if (!x || !width || !y || !height) return;
		const position = x.read(time);
		const size = width.read(time);
		const vertical = y.read(time);
		const tall = height.read(time);
		pill.style.transform = `translate(${position.value}px, ${vertical.value}px)`;
		pill.style.height = `${tall.value}px`;
		pill.style.width = `${size.value}px`;
		if (
			Math.abs(position.value - x.target) +
				Math.abs(size.value - width.target) +
				Math.abs(vertical.value - y.target) +
				Math.abs(tall.value - height.target) >
				0.01 ||
			Math.abs(position.velocity) +
				Math.abs(size.velocity) +
				Math.abs(vertical.velocity) +
				Math.abs(tall.velocity) >
				0.05
		)
			frame = requestAnimationFrame(tick);
	};
	const update = () => {
		const selected = Array.from(
			root.querySelectorAll<HTMLElement>(
				"button[aria-pressed=true], button[aria-selected=true], a[aria-current=page]",
			),
		).find((button) => button.closest(".jk-motion-group") === root);
		if (!selected || !selected.offsetWidth) return;
		if (!x || !width || reducedMotion()) {
			x = new InterfaceSpring(selected.offsetLeft);
			width = new InterfaceSpring(selected.offsetWidth);
			y = new InterfaceSpring(selected.offsetTop);
			height = new InterfaceSpring(selected.offsetHeight);
			tick(performance.now());
		} else {
			x.retarget(selected.offsetLeft, performance.now());
			width.retarget(selected.offsetWidth, performance.now());
			y?.retarget(selected.offsetTop, performance.now());
			height?.retarget(selected.offsetHeight, performance.now());
		}
		pill.style.opacity = "1";
		frame ||= requestAnimationFrame(tick);
	};
	onMount(() => {
		const changes = new MutationObserver(update);
		changes.observe(root, {
			subtree: true,
			attributes: true,
			attributeFilter: ["aria-pressed", "aria-selected", "aria-current"],
		});
		const size = new ResizeObserver(update);
		size.observe(root);
		for (const button of root.querySelectorAll("button")) size.observe(button);
		update();
		onCleanup(() => {
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
	children: (value: Accessor<T>) => JSX.Element;
}) {
	const [displayed, setDisplayed] = createSignal(props.value);
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
					!props.order ||
					props.order.indexOf(value) >= props.order.indexOf(displayed())
						? 1
						: -1;
				const opacity = getComputedStyle(root).opacity;
				const transform = getComputedStyle(root).transform;
				cancel();
				root.inert = true;
				if (!reducedMotion()) {
					const exit = root.animate(
						[
							{ opacity, transform },
							{
								opacity: 0,
								transform:
									kind === "page"
										? "translateY(26px) scale(.985)"
										: `translateX(${-direction * 18}px) scale(.985)`,
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
				cancel();
				root.inert = false;
				if (reducedMotion()) return;
				animations.push(
					root.animate(arrivalFrames(kind, direction), {
						duration: 700,
						easing: "linear",
					}),
				);
				if (kind === "page") {
					const bounds = root.getBoundingClientRect();
					const sections = root.querySelectorAll<HTMLElement>(
						"[data-motion-section], [role=tabpanel]:not([hidden]) > div, .jk-motion-content > .jk-layout-settings, .jk-motion-content > .jk-cursor-settings, .jk-motion-content > .jk-background-settings",
					);
					for (const section of sections) {
						if (
							!section.offsetHeight ||
							section.parentElement?.closest("[data-motion-section]")
						)
							continue;
						const delay =
							(Math.min(
								900,
								Math.max(0, section.getBoundingClientRect().top - bounds.top),
							) /
								900) *
							300;
						animations.push(
							section.animate(
								springFrames(0.62, 0.82, 0.85).map(({ offset, progress }) => ({
									offset,
									opacity: Math.min(1, Math.max(0, progress)),
									transform: `translateY(${40 * (1 - progress)}px) scale(${0.96 + 0.04 * progress})`,
								})),
								{ duration: 850, delay, easing: "linear", fill: "backwards" },
							),
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
			class="jk-motion-content"
			data-motion-kind={props.kind ?? "page"}
		>
			{props.children(displayed)}
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
							duration: 700,
							delay: 120,
							fill: "backwards",
							easing: "linear",
						});
				} else {
					if (!reducedMotion()) {
						animation = root.animate(
							[
								{ opacity },
								{ opacity: 0, transform: "translateY(26px) scale(.985)" },
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
			{props.children}
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
	const state: { revision: number; animation?: Animation } = { revision };
	pageChanges.set(root, state);
	if (reducedMotion()) {
		change();
		return;
	}
	state.animation = root.animate(
		[
			{ opacity, transform },
			{ opacity: 0, transform: `translateX(${-18 * direction}px) scale(.985)` },
		],
		{
			duration: interfaceMotion.outgoing.duration,
			easing: interfaceMotion.outgoing.easing,
			fill: "forwards",
		},
	);
	await state.animation.finished.catch(() => {});
	if (pageChanges.get(root) !== state) return;
	change();
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
	if (pageChanges.get(root) !== state) return;
	state.animation.cancel();
	state.animation = root.animate(arrivalFrames("subpage", direction), {
		duration: 700,
		easing: "linear",
	});
}
