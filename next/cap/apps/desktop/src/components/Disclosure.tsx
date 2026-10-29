import { Collapsible } from "@kobalte/core/collapsible";
import type { JSX } from "solid-js";

export function Disclosure(props: {
	title: JSX.Element;
	children: JSX.Element;
	class?: string;
}) {
	return (
		<Collapsible class={`jk-disclosure ${props.class ?? ""}`}>
			<Collapsible.Trigger class="jk-disclosure-trigger">
				<span>{props.title}</span>
				<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
					<path
						d="m4 6 4 4 4-4"
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			</Collapsible.Trigger>
			<Collapsible.Content class="jk-disclosure-content">
				{props.children}
			</Collapsible.Content>
		</Collapsible>
	);
}
