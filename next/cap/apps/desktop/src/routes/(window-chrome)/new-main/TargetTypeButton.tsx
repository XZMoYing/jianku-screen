import { cx } from "cva";
import { type Component, type ComponentProps, splitProps } from "solid-js";
import { MotionText } from "~/components/MotionText";
import { StatusLed } from "~/components/StatusLed";

type TargetTypeButtonProps = {
	selected: boolean;
	Component: Component<ComponentProps<"svg">>;
	name: string;
	description?: string;
	disabled?: boolean;
} & ComponentProps<"button">;

function TargetTypeButton(props: TargetTypeButtonProps) {
	const [local, rest] = splitProps(props, [
		"selected",
		"Component",
		"name",
		"description",
		"disabled",
		"class",
	]);

	return (
		<button
			{...rest}
			type="button"
			disabled={local.disabled}
			aria-pressed={local.selected ? "true" : "false"}
			class={cx(
				"jk-source-tile relative flex flex-1 flex-col items-center gap-1 rounded-lg border py-2 text-center transition-[background-color,border-color,color,transform] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-9 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-1",
				local.description &&
					"min-h-14 flex-row items-center justify-start gap-2.5 px-3 text-left",
				!local.description && "justify-end",
				local.selected
					? "is-active border-blue-8 bg-blue-3 text-blue-11 hover:border-blue-9 hover:bg-blue-4 active:bg-blue-5 dark:bg-blue-3/30 dark:hover:bg-blue-4/40"
					: "border-gray-6 bg-gray-2 text-gray-12 hover:border-gray-8 hover:bg-gray-4 active:bg-gray-5",
				local.disabled && "pointer-events-none opacity-60",
				local.class,
			)}
		>
			<StatusLed active={local.selected} class="jk-src-led" />
			<local.Component
				class={cx(
					"size-5 shrink-0 transition-colors",
					local.selected ? "text-current" : "text-gray-10",
				)}
			/>
			<div class="min-w-0">
				<p
					class={cx(
						"text-xs truncate",
						local.description && "font-medium leading-4",
					)}
				>
					<MotionText text={local.name} />
				</p>
				{local.description && (
					<p
						class={cx(
							"text-[10px] leading-3 truncate",
							local.selected ? "opacity-80" : "text-gray-10",
						)}
					>
						<MotionText text={local.description} />
					</p>
				)}
			</div>
		</button>
	);
}

export default TargetTypeButton;
