export const interfaceMotion = {
	menu: { response: 0.36, damping: 0.82, duration: 420, fade: 180, travel: 6 },
	selection: { response: 0.44, damping: 0.72 },
	page: { response: 0.46, damping: 0.84, duration: 540, travel: 14 },
	subpage: { response: 0.46, damping: 0.84, duration: 520, travel: 22 },
	section: { response: 0.52, damping: 0.84, duration: 520, travel: 18 },
	outgoing: { duration: 145, easing: "cubic-bezier(.5,0,.9,.5)" },
	text: {
		response: 0.58,
		damping: 0.76,
		duration: 700,
		stagger: 28,
		delay: 32,
	},
} as const;

export function motionGlyphs(text: string): string[] {
	if (text.length > 40) return [text];
	return Array.from(
		new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text),
		(part) => part.segment,
	);
}
