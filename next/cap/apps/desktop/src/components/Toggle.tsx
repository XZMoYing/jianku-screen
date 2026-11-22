import { Switch as KSwitch } from "@kobalte/core/switch";
import { cva } from "cva";
import { type ComponentProps, splitProps } from "solid-js";
import { StatusLed } from "./StatusLed";

const toggleControlStyles = cva(
	"cap-toggle inline-flex items-center rounded-full cursor-pointer transition-[background-color,border-color,box-shadow]",
	{
		variants: {
			size: {
				sm: "cap-toggle-sm",
				md: "cap-toggle-md",
				lg: "cap-toggle-lg",
			},
		},
		defaultVariants: {
			size: "md",
		},
	},
);

const toggleThumbStyles = cva(
	"cap-toggle-thumb grid place-items-center rounded-full",
	{
		variants: {
			size: {
				sm: "cap-toggle-thumb-sm",
				md: "cap-toggle-thumb-md",
				lg: "cap-toggle-thumb-lg",
			},
		},
		defaultVariants: {
			size: "md",
		},
	},
);

export function Toggle(
	props: ComponentProps<typeof KSwitch> & { size?: "sm" | "md" | "lg" },
) {
	const [local, others] = splitProps(props, ["size"]);

	return (
		<KSwitch class="relative jk-toggle-shell" {...others}>
			<KSwitch.Input class="peer absolute inset-0 opacity-0" />
			<KSwitch.Control class={toggleControlStyles({ size: local.size })}>
				<KSwitch.Thumb class={toggleThumbStyles({ size: local.size })}>
					<StatusLed active={Boolean(others.checked)} class="jk-sw-led" />
				</KSwitch.Thumb>
			</KSwitch.Control>
		</KSwitch>
	);
}
