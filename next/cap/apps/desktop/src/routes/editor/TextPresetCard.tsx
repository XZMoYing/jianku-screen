import { cx } from "cva";
import type { JSX } from "solid-js";
import { t as localize } from "~/utils/i18n";
import type { TextPreset } from "./text-presets";

const fontStackCss = (stack: string[]) =>
	stack
		.map((family) =>
			["sans-serif", "serif", "monospace"].includes(family)
				? family
				: `"${family}"`,
		)
		.join(", ");

export function TextPresetCard(props: {
	preset: TextPreset;
	active: boolean;
	onApply: () => void;
}) {
	const style = () => props.preset.style;

	const textColor = () => style().color ?? "#ffffff";

	const textStyle = (): JSX.CSSProperties => {
		const s = style();
		const shadows: string[] = [];
		if (s.shadow > 0)
			shadows.push(`0 1px 3px rgba(0, 0, 0, ${0.45 + s.shadow * 0.4})`);
		if (s.glow > 0)
			shadows.push(`0 0 6px ${textColor()}`, `0 0 14px ${textColor()}`);

		const css: JSX.CSSProperties = {
			"font-family": fontStackCss(s.fontStack),
			"font-weight": String(s.fontWeight),
			"font-style": s.italic ? "italic" : "normal",
			"text-transform": s.uppercase ? "uppercase" : "none",
			"font-size": `${Math.min(Math.max(s.fontSize * 0.2, 11), 22)}px`,
			"letter-spacing": `${s.letterSpacing * 0.35}px`,
			"line-height": "1.1",
			color: textColor(),
		};
		if (shadows.length > 0) css["text-shadow"] = shadows.join(", ");
		if (s.strokeWidth > 0) {
			css["-webkit-text-stroke"] = `${s.strokeWidth * 0.18}px ${s.strokeColor}`;
			css["paint-order"] = "stroke fill";
		}
		if (s.gradientColor) {
			css.background = `linear-gradient(90deg, ${textColor()}, ${s.gradientColor})`;
			css["-webkit-background-clip"] = "text";
			css["background-clip"] = "text";
			css.color = "transparent";
		}
		return css;
	};

	const backgroundStyle = (): JSX.CSSProperties => {
		const s = style();
		if (!s.backgroundColor) return {};
		return {
			"background-color": s.backgroundColor,
			padding: s.backgroundStyle === "highlight" ? "0 0.25em" : "0.15em 0.4em",
			"border-radius":
				s.backgroundStyle === "pill"
					? "9999px"
					: s.backgroundStyle === "highlight"
						? "0.15em"
						: "0.2em",
		};
	};

	return (
		<button
			type="button"
			onClick={() => props.onApply()}
			class={cx(
				"overflow-hidden relative flex justify-center items-center px-2 pb-3 h-[68px] rounded-[10px] transition-shadow",
				props.active
					? "ring-2 ring-ed-accent ring-offset-2 ring-offset-ed-card-2"
					: "ring-1 ring-ed-line hover:ring-ed-line-strong",
			)}
			style={{
				background:
					"linear-gradient(160deg, var(--jk-graphite), color-mix(in srgb, var(--jk-graphite) 88%, var(--jk-muted)))",
			}}
		>
			<span class="inline-block max-w-full" style={backgroundStyle()}>
				<span class="block max-w-full truncate" style={textStyle()}>
					{props.preset.sample}
				</span>
			</span>
			<span class="absolute inset-x-0 bottom-1.5 text-center text-[10px] font-medium text-white/55">
				{localize(props.preset.name)}
			</span>
		</button>
	);
}
