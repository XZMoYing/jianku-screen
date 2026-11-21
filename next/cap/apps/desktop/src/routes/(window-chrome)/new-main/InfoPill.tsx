import { cx } from "cva";
import { type ComponentProps, splitProps } from "solid-js";
import { MotionText } from "~/components/MotionText";
import { StatusLed } from "~/components/StatusLed";

export type InfoPillVariant = "blue" | "red" | "gray";

export default function InfoPill(
	props: ComponentProps<"button"> & { variant: InfoPillVariant },
) {
	const [local, rest] = splitProps(props, ["variant", "class", "children"]);
	const isActive = () => local.variant === "blue";
	const textChild = () =>
		typeof local.children === "string" ? local.children : null;

	return (
		<button
			{...rest}
			type="button"
			aria-label={rest["aria-label"] ?? textChild() ?? undefined}
			data-pill-variant={local.variant}
			class={cx(
				"jk-dev-state inline-flex items-center justify-center gap-1.5 min-w-[40px] h-[24px] px-2.5 rounded-full text-[11px] font-medium leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-9 focus-visible:ring-offset-1 focus-visible:ring-offset-gray-1",
				local.variant === "blue" && "is-on",
				local.variant === "red" && "is-warn",
				local.variant === "gray" && "is-off",
				local.class,
			)}
		>
			<StatusLed active={isActive()} class="jk-dev-led" />
			{textChild() !== null ? (
				<MotionText text={textChild() ?? ""} />
			) : (
				local.children
			)}
		</button>
	);
}
