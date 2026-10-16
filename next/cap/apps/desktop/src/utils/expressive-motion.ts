export function springProgress(
	time: number,
	stiffness = 380,
	dampingRatio = 0.82,
): number {
	const omega = Math.sqrt(stiffness);
	const damped = omega * Math.sqrt(1 - dampingRatio ** 2);
	return (
		1 -
		Math.exp(-dampingRatio * omega * time) *
			(Math.cos(damped * time) +
				((dampingRatio * omega) / damped) * Math.sin(damped * time))
	);
}
const frames = Array.from({ length: 49 }, (_, i) => {
	const progress = springProgress((i / 48) * 0.55);
	return { offset: i / 48, transform: `scale(${0.97 + 0.03 * progress})` };
});
export function installExpressiveMotion() {
	const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
	if (CSS.supports("transition-timing-function", "linear(0, 1)")) {
		document.documentElement.style.setProperty(
			"--jk-spatial",
			`linear(${Array.from({ length: 49 }, (_, i) => springProgress((i / 48) * 0.55).toFixed(5)).join(",")})`,
		);
	}
	const active = new Map<HTMLElement, Animation>();
	const press = (event: PointerEvent) => {
		if (reduced.matches || event.button !== 0) return;
		const button = (event.target as Element).closest<HTMLElement>(
			".jk-button, .jk-tonal-button, .workspace-modes button, .workspace-sources button, .jk-appearance-tabs button",
		);
		if (!button || button.matches(":disabled")) return;
		active.get(button)?.cancel();
		const animation = button.animate(frames, {
			duration: 550,
			easing: "linear",
		});
		active.set(button, animation);
		animation.onfinish = () => active.delete(button);
	};
	const enter = (event: MouseEvent) => {
		if (reduced.matches) return;
		const target = (event.target as Element).closest(
			"[role=tab], .jk-appearance-tabs button",
		);
		if (!target) return;
		requestAnimationFrame(() => {
			const panel =
				target
					.closest("[role=tablist]")
					?.parentElement?.querySelector<HTMLElement>(
						"[role=tabpanel]:not([hidden])",
					) ?? target.closest(".jk-appearance-controls");
			panel?.animate(
				[
					{ opacity: 0.6, transform: "translateY(5px)" },
					{ opacity: 1, transform: "translateY(0)" },
				],
				{ duration: 220, easing: "cubic-bezier(0.2, 0, 0, 1)" },
			);
		});
	};
	document.addEventListener("pointerdown", press);
	document.addEventListener("click", enter);
	return () => {
		document.removeEventListener("pointerdown", press);
		document.removeEventListener("click", enter);
		for (const animation of active.values()) animation.cancel();
		active.clear();
	};
}
