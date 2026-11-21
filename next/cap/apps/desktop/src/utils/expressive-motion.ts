import { interfaceMotion } from "./interface-motion-tokens";
import { InterfaceSpring, springFrames } from "./interface-spring";

export function installExpressiveMotion() {
	const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
	if (CSS.supports("transition-timing-function", "linear(0, 1)")) {
		document.documentElement.style.setProperty(
			"--jk-spatial",
			`linear(${springFrames(0.44, 0.84, 0.56)
				.map((frame) => frame.progress.toFixed(5))
				.join(",")})`,
		);
	}
	const menu = interfaceMotion.menu;
	if (CSS.supports("transition-timing-function", "linear(0, 1)")) {
		document.documentElement.style.setProperty(
			"--jk-menu-spring",
			`linear(${springFrames(menu.response, menu.damping, menu.duration / 1000)
				.map((frame) => frame.progress.toFixed(5))
				.join(",")})`,
		);
	}
	const active = new Map<
		HTMLElement,
		{ spring: InterfaceSpring; previousScale: string }
	>();
	const pointers = new Map<number, HTMLElement>();
	const keys = new Map<string, HTMLElement>();
	let frame = 0;
	const tick = (time: number) => {
		frame = 0;
		for (const [element, motion] of active) {
			const state = motion.spring.read(time);
			const settled =
				Math.abs(state.velocity) < 0.0001 &&
				Math.abs(state.value - motion.spring.target) < 0.00001;
			if (!element.isConnected || (settled && motion.spring.target === 1)) {
				element.style.setProperty("scale", motion.previousScale);
				active.delete(element);
			} else {
				element.style.setProperty("scale", String(state.value));
				if (!settled) frame ||= requestAnimationFrame(tick);
			}
		}
	};
	const setPressed = (element: HTMLElement, pressed: boolean) => {
		element.toggleAttribute("data-jk-pressed", pressed);
		if (reduced.matches) return;
		let motion = active.get(element);
		if (!motion) {
			motion = {
				spring: new InterfaceSpring(1),
				previousScale: element.style.getPropertyValue("scale"),
			};
			active.set(element, motion);
		}
		motion.spring.retarget(
			pressed ? 0.96 : 1,
			performance.now(),
			pressed ? 0.28 : 0.34,
			pressed ? 0.84 : 0.76,
		);
		frame ||= requestAnimationFrame(tick);
	};
	const buttonAt = (event: Event) => {
		const element =
			event.target instanceof Element
				? event.target.closest<HTMLElement>("button:not([role=switch])")
				: null;
		return element && !element.matches(":disabled, [aria-disabled=true]")
			? element
			: null;
	};
	const trackGlow = (event: PointerEvent) => {
		if (reduced.matches) return;
		const target =
			event.target instanceof Element
				? event.target.closest<HTMLElement>(
						".jk-button, .studio-primary, .jk-capture-targets button, .jk-device-row, .jk-stage-footer button",
					)
				: null;
		if (!target) return;
		const rect = target.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return;
		target.style.setProperty("--gx", `${event.clientX - rect.left}px`);
		target.style.setProperty("--gy", `${event.clientY - rect.top}px`);
	};
	const releasePointer = (event: PointerEvent) => {
		const element = pointers.get(event.pointerId);
		if (element) setPressed(element, false);
		pointers.delete(event.pointerId);
	};
	const pressPointer = (event: PointerEvent) => {
		if (event.button !== 0) return;
		releasePointer(event);
		const element = buttonAt(event);
		if (!element) return;
		pointers.set(event.pointerId, element);
		setPressed(element, true);
	};
	const leavePointer = (event: PointerEvent) => {
		const element = pointers.get(event.pointerId);
		if (element && !element.contains(event.relatedTarget as Node | null))
			releasePointer(event);
	};
	const pressKey = (event: KeyboardEvent) => {
		if (event.repeat || ![" ", "Enter"].includes(event.key)) return;
		const element = buttonAt(event);
		if (!element) return;
		keys.set(event.key, element);
		setPressed(element, true);
	};
	const releaseKey = (event: KeyboardEvent) => {
		const element = keys.get(event.key);
		if (element) setPressed(element, false);
		keys.delete(event.key);
	};
	const releaseAll = () => {
		for (const element of [...pointers.values(), ...keys.values()])
			setPressed(element, false);
		pointers.clear();
		keys.clear();
	};
	const clear = () => {
		releaseAll();
		cancelAnimationFrame(frame);
		frame = 0;
		for (const [element, motion] of active)
			element.style.setProperty("scale", motion.previousScale);
		active.clear();
	};
	document.addEventListener("pointermove", trackGlow, { passive: true });
	document.addEventListener("pointerdown", pressPointer);
	document.addEventListener("pointerup", releasePointer);
	document.addEventListener("pointercancel", releasePointer);
	document.addEventListener("pointerout", leavePointer);
	document.addEventListener("keydown", pressKey);
	document.addEventListener("keyup", releaseKey);
	window.addEventListener("blur", releaseAll);
	reduced.addEventListener("change", clear);
	return () => {
		clear();
		document.removeEventListener("pointermove", trackGlow);
		document.removeEventListener("pointerdown", pressPointer);
		document.removeEventListener("pointerup", releasePointer);
		document.removeEventListener("pointercancel", releasePointer);
		document.removeEventListener("pointerout", leavePointer);
		document.removeEventListener("keydown", pressKey);
		document.removeEventListener("keyup", releaseKey);
		window.removeEventListener("blur", releaseAll);
		reduced.removeEventListener("change", clear);
	};
}
