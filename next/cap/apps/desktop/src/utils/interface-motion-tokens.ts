export const interfaceMotion = {
	menu: { response: 0.36, damping: 0.84, duration: 450, fade: 180, travel: 6 },
	selection: { response: 0.38, damping: 1 },
	page: { response: 0.42, damping: 0.86, duration: 700, travel: 14 },
	subpage: { response: 0.4, damping: 0.84, duration: 700, travel: 26 },
	section: { response: 0.62, damping: 0.82, duration: 850, travel: 40 },
	outgoing: { duration: 140, easing: "cubic-bezier(.5,0,.9,.5)" },
	text: {
		response: 0.66,
		damping: 0.74,
		duration: 850,
		stagger: 35,
		delay: 40,
	},
} as const;

export function motionGlyphs(text: string): string[] {
	if (text.length > 40) return [text];
	return Array.from(
		new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text),
		(part) => part.segment,
	);
}
