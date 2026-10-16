import {
	type Accessor,
	createEffect,
	createSignal,
	type JSX,
	on,
	onCleanup,
	onMount,
} from "solid-js";
import { InterfaceSpring, springFrames } from "~/utils/interface-spring";

const enterFrames = springFrames().map(({ offset, progress }) => ({
	offset,
	opacity: Math.min(1, Math.max(0, progress)),
	transform: `translateY(${14 * (1 - progress)}px) scale(${0.985 + 0.015 * progress})`,
}));
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
	const tick = (time: number) => {
		frame = 0;
		if (!x || !width) return;
		const position = x.read(time);
		const size = width.read(time);
		pill.style.transform = `translateX(${position.value}px)`;
		pill.style.width = `${size.value}px`;
		if (
			Math.abs(position.value - x.target) +
				Math.abs(size.value - width.target) >
				0.01 ||
			Math.abs(position.velocity) + Math.abs(size.velocity) > 0.05
		)
			frame = requestAnimationFrame(tick);
	};
	const update = () => {
		const selected = root.querySelector<HTMLElement>(
			"button[aria-pressed=true], button[aria-selected=true]",
		);
		if (!selected || !selected.offsetWidth) return;
		if (!x || !width || reducedMotion()) {
			x = new InterfaceSpring(selected.offsetLeft);
			width = new InterfaceSpring(selected.offsetWidth);
			tick(performance.now());
		} else {
			x.retarget(selected.offsetLeft, performance.now());
			width.retarget(selected.offsetWidth, performance.now());
		}
		pill.style.opacity = "1";
		frame ||= requestAnimationFrame(tick);
	};
	onMount(() => {
		const changes = new MutationObserver(update);
		changes.observe(root, {
			subtree: true,
			attributes: true,
			attributeFilter: ["aria-pressed", "aria-selected"],
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
	children: (value: Accessor<T>) => JSX.Element;
}) {
	const [displayed, setDisplayed] = createSignal(props.value);
	let root!: HTMLDivElement;
	let revision = 0;
	let animation: Animation | undefined;
	createEffect(
		on(
			() => props.value,
			async (value) => {
				const generation = ++revision;
				const opacity = getComputedStyle(root).opacity;
				const transform = getComputedStyle(root).transform;
				animation?.cancel();
				if (!reducedMotion()) {
					animation = root.animate(
						[
							{ opacity, transform },
							{ opacity: 0, transform: "translateY(-6px) scale(.995)" },
						],
						{
							duration: 120,
							easing: "cubic-bezier(.5,0,.9,.5)",
							fill: "forwards",
						},
					);
					await animation.finished.catch(() => {});
				}
				if (generation !== revision) return;
				setDisplayed(() => value);
				animation?.cancel();
				if (!reducedMotion())
					animation = root.animate(enterFrames, {
						duration: 650,
						easing: "linear",
					});
			},
			{ defer: true },
		),
	);
	onCleanup(() => {
		revision++;
		animation?.cancel();
	});
	return (
		<div ref={root} class="jk-motion-content">
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
							duration: 650,
							easing: "linear",
						});
				} else {
					if (!reducedMotion()) {
						animation = root.animate([{ opacity }, { opacity: 0 }], {
							duration: 120,
							fill: "forwards",
						});
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
