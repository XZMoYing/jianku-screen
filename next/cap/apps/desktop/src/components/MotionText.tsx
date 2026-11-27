import {
	createEffect,
	createSignal,
	For,
	on,
	onCleanup,
	onMount,
} from "solid-js";
import { useMotionInteraction } from "~/components/InterfaceMotion";
import { interfaceMotion, motionGlyphs } from "~/utils/interface-motion-tokens";
import { springFrames } from "~/utils/interface-spring";

export function MotionText(props: { text: string; class?: string }) {
	const interactive = useMotionInteraction();
	let root!: HTMLSpanElement;
	let animations: Animation[] = [];
	let frame = 0;
	let revision = 0;
	let lastVisibleText = props.text;
	const [outgoing, setOutgoing] = createSignal("");
	const clear = () => {
		revision++;
		cancelAnimationFrame(frame);
		for (const animation of animations) animation.cancel();
		animations = [];
		setOutgoing("");
	};
	const runTransition = (from: string, to: string) => {
		clear();
		if (
			to === from ||
			!root ||
			document.visibilityState !== "visible" ||
			window.matchMedia("(prefers-reduced-motion: reduce)").matches
		)
			return;
		setOutgoing(from);
		const generation = revision;
		frame = requestAnimationFrame(() => {
			frame = 0;
			const timing = interfaceMotion.text;
			const inFrames = springFrames(
				timing.response,
				timing.damping,
				timing.duration / 1000,
			).map(({ offset, progress }) => ({
				offset,
				opacity: Math.min(1, Math.max(0, progress * 2.35)),
				transform: `translateY(${(1.08 * (1 - progress)).toFixed(3)}em)`,
				filter: `blur(${(7.2 * Math.max(0, 1 - progress)).toFixed(2)}px)`,
			}));
			for (const [index, glyph] of root
				.querySelectorAll<HTMLElement>(".jk-motion-glyph")
				.entries()) {
				animations.push(
					glyph.animate(inFrames, {
						duration: timing.duration,
						delay: Math.min(index, 10) * timing.stagger + timing.delay,
						fill: "backwards",
						easing: "linear",
					}),
				);
			}
			for (const [index, glyph] of root
				.querySelectorAll<HTMLElement>(".jk-motion-glyph-out")
				.entries()) {
				animations.push(
					glyph.animate(
						[
							{
								opacity: 1,
								transform: "translateY(0)",
								filter: "blur(0px)",
							},
							{
								opacity: 0,
								transform: "translateY(-0.95em)",
								filter: "blur(5.5px)",
							},
						],
						{
							duration: 210,
							delay: Math.min(index, 10) * 16,
							easing: "cubic-bezier(0.45, 0, 0.85, 0.5)",
							fill: "forwards",
						},
					),
				);
			}
			void Promise.all(
				animations.map((animation) => animation.finished.catch(() => {})),
			).then(() => {
				if (generation === revision) setOutgoing("");
			});
		});
	};
	createEffect(
		on(
			() => props.text,
			(text, previous) => {
				if (!interactive()) {
					clear();
					return;
				}
				const from = lastVisibleText ?? previous ?? "";
				lastVisibleText = text;
				runTransition(from, text);
			},
			{ defer: true },
		),
	);
	createEffect(
		on(
			interactive,
			(isInteractive) => {
				if (!isInteractive) return;
				const current = props.text;
				if (current !== lastVisibleText) {
					const from = lastVisibleText;
					lastVisibleText = current;
					runTransition(from, current);
				}
			},
			{ defer: true },
		),
	);
	onMount(() => {
		const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
		reduced.addEventListener("change", clear);
		document.addEventListener("visibilitychange", clear);
		onCleanup(() => {
			reduced.removeEventListener("change", clear);
			document.removeEventListener("visibilitychange", clear);
		});
	});
	onCleanup(clear);
	return (
		<span
			ref={root}
			class={`jk-motion-text ${props.class ?? ""}`}
			aria-label={props.text}
		>
			<span class="jk-motion-text-size" aria-hidden="true">
				{props.text}
			</span>
			<span class="jk-motion-text-outgoing" aria-hidden="true">
				<For each={outgoing() ? motionGlyphs(outgoing()) : []}>
					{(glyph) => (
						<span class="jk-motion-glyph-out">
							{glyph === " " ? "\u00a0" : glyph}
						</span>
					)}
				</For>
			</span>
			<span class="jk-motion-text-glyphs" aria-hidden="true">
				<For each={motionGlyphs(props.text)}>
					{(glyph) => (
						<span class="jk-motion-glyph">
							{glyph === " " ? "\u00a0" : glyph}
						</span>
					)}
				</For>
			</span>
		</span>
	);
}
