import { createEffect, on, onCleanup } from "solid-js";

const reducedMotion = () =>
	typeof window === "undefined" ||
	document.visibilityState !== "visible" ||
	window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function igniteLed(ledEl: HTMLElement | undefined | null) {
	if (!ledEl || reducedMotion() || typeof ledEl.animate !== "function") return;
	for (const anim of ledEl.getAnimations?.() ?? []) anim.cancel();
	// Core LED bead: rapid punch overshoot (0 -> 16%, 1.68x + bright flash)
	// followed by silky exponential settle back to resting 1.0x.
	ledEl.animate(
		[
			{ transform: "scale(0.62)", filter: "brightness(0.9)", offset: 0 },
			{
				transform: "scale(1.68)",
				filter: "brightness(1.55)",
				offset: 0.16,
				easing: "cubic-bezier(0.10, 0.96, 0.24, 1)",
			},
			{
				transform: "scale(1.16)",
				filter: "brightness(1.22)",
				offset: 0.42,
				easing: "cubic-bezier(0.22, 1, 0.36, 1)",
			},
			{
				transform: "scale(0.95)",
				filter: "brightness(1.02)",
				offset: 0.72,
				easing: "cubic-bezier(0.32, 0, 0.2, 1)",
			},
			{ transform: "scale(1.00)", filter: "brightness(1)", offset: 1 },
		],
		{ duration: 680, fill: "none" },
	);

	// Independent optical halo ring: rapid expansion to 3.5x then silky contraction
	for (const oldHalo of ledEl.querySelectorAll(".jk-led-halo"))
		oldHalo.remove();
	const halo = document.createElement("span");
	halo.className = "jk-led-halo";
	ledEl.appendChild(halo);
	const haloAnim = halo.animate(
		[
			{
				transform: "translate(-50%, -50%) scale(0.5)",
				opacity: 0.92,
				offset: 0,
			},
			{
				transform: "translate(-50%, -50%) scale(3.5)",
				opacity: 0.62,
				offset: 0.2,
				easing: "cubic-bezier(0.08, 0.95, 0.25, 1)",
			},
			{
				transform: "translate(-50%, -50%) scale(2.1)",
				opacity: 0.28,
				offset: 0.56,
				easing: "cubic-bezier(0.22, 1, 0.36, 1)",
			},
			{
				transform: "translate(-50%, -50%) scale(1.25)",
				opacity: 0,
				offset: 1,
			},
		],
		{ duration: 720, fill: "forwards" },
	);
	haloAnim.onfinish = () => halo.remove();
}

export function StatusLed(props: { active: boolean; class?: string }) {
	let ref: HTMLSpanElement | undefined;
	createEffect(
		on(
			() => props.active,
			(active, prev) => {
				if (active && prev === false) {
					igniteLed(ref);
				}
			},
			{ defer: true },
		),
	);
	onCleanup(() => {
		if (!ref) return;
		for (const anim of ref.getAnimations?.() ?? []) anim.cancel();
		for (const halo of ref.querySelectorAll(".jk-led-halo")) halo.remove();
	});
	return (
		<span
			ref={ref}
			aria-hidden="true"
			class={`jk-led ${props.class ?? ""}`}
			data-active={props.active ? "true" : "false"}
		/>
	);
}
