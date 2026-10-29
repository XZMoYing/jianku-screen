import {
	createEffect,
	createSignal,
	For,
	on,
	onCleanup,
	onMount,
} from "solid-js";
import { interfaceMotion, motionGlyphs } from "~/utils/interface-motion-tokens";
import { springFrames } from "~/utils/interface-spring";

export function MotionText(props: { text: string; class?: string }) {
	let root!: HTMLSpanElement;
	let animations: Animation[] = [];
	let frame = 0;
	let revision = 0;
	const [outgoing, setOutgoing] = createSignal("");
	const clear = () => {
		revision++;
		cancelAnimationFrame(frame);
		for (const animation of animations) animation.cancel();
		animations = [];
		setOutgoing("");
	};
	createEffect(
		on(
			() => props.text,
			(text, previous) => {
				clear();
				if (
					text === previous ||
					!root ||
					document.visibilityState !== "visible" ||
					window.matchMedia("(prefers-reduced-motion: reduce)").matches
				)
					return;
				setOutgoing(previous ?? "");
				const generation = revision;
				frame = requestAnimationFrame(() => {
					frame = 0;
					const timing = interfaceMotion.text;
					for (const [index, glyph] of root
						.querySelectorAll<HTMLElement>(".jk-motion-glyph")
						.entries()) {
						animations.push(
							glyph.animate(
								springFrames(
									timing.response,
									timing.damping,
									timing.duration / 1000,
								).map(({ offset, progress }) => ({
									offset,
									opacity: Math.min(1, Math.max(0, progress * 2.4)),
									transform: `translateY(${1.1 * (1 - progress)}em)`,
									filter: `blur(${8 * Math.max(0, 1 - progress)}px)`,
								})),
								{
									duration: timing.duration,
									delay: Math.min(index, 8) * timing.stagger + timing.delay,
									fill: "backwards",
									easing: "linear",
								},
							),
						);
					}
					const old = root.querySelector(".jk-motion-text-outgoing");
					if (old)
						animations.push(
							old.animate(
								[
									{ opacity: 1, transform: "translateY(0)", filter: "blur(0)" },
									{
										opacity: 0,
										transform: "translateY(-.7em)",
										filter: "blur(6px)",
									},
								],
								{ duration: 160, easing: "ease-in", fill: "forwards" },
							),
						);
					void Promise.all(
						animations.map((animation) => animation.finished.catch(() => {})),
					).then(() => {
						if (generation === revision) setOutgoing("");
					});
				});
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
				{outgoing()}
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
