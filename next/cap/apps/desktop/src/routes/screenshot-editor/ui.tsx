import { Polymorphic, type PolymorphicProps } from "@kobalte/core/polymorphic";
import { cva, cx, type VariantProps } from "cva";
import {
	type ComponentProps,
	type JSX,
	mergeProps,
	type ParentProps,
	splitProps,
	type ValidComponent,
} from "solid-js";
import Tooltip from "~/components/Tooltip";
import { t as localize } from "~/utils/i18n";
import { Slider as EditorSlider } from "../editor/ui";
import { useScreenshotEditorContext } from "./context";
import { TextInput } from "./TextInput";

export {
	ComingSoonTooltip,
	Dialog,
	DialogContent,
	DropdownItem,
	dropdownContainerClasses,
	MenuItem,
	MenuItemList,
	PopperContent,
	topCenterAnimateClasses,
	topLeftAnimateClasses,
	topRightAnimateClasses,
	topSlideAnimateClasses,
} from "../editor/ui";

export function Field(
	props: ParentProps<{
		name: string;
		icon?: JSX.Element;
		value?: JSX.Element;
		class?: string;
		disabled?: boolean;
	}>,
) {
	return (
		<div class={cx("flex flex-col gap-4", props.class)}>
			<span
				data-disabled={props.disabled}
				class="flex flex-row items-center gap-1.5 text-gray-12 data-[disabled='true']:text-gray-10 font-medium text-sm"
			>
				{props.icon}
				{localize(props.name)}
				{props.value && <div class="ml-auto">{props.value}</div>}
			</span>
			{props.children}
		</div>
	);
}

export function Subfield(
	props: ParentProps<{ name: string; class?: string; required?: boolean }>,
) {
	return (
		<div class={cx("flex flex-row justify-between items-center", props.class)}>
			<span class="font-medium text-gray-12">
				{localize(props.name)}
				{props.required && (
					<span class="ml-[2px] text-xs text-[var(--jk-primary)]">*</span>
				)}
			</span>
			{props.children}
		</div>
	);
}

export function Slider(props: ComponentProps<typeof EditorSlider>) {
	const { projectHistory } = useScreenshotEditorContext();
	return <EditorSlider {...props} history={props.history ?? projectHistory} />;
}

export function Input(props: ComponentProps<"input">) {
	return (
		<TextInput
			{...props}
			class={cx(
				"rounded-lg bg-gray-2 hover:ring-1 py-[18px] hover:ring-gray-5 h-8 font-normal placeholder:text-black-transparent-40 text-xs caret-gray-500 transition-shadow duration-200 focus:ring-offset-1 focus:bg-gray-3 focus:ring-offset-gray-100 focus:ring-1 focus:ring-gray-10 px-2 w-full outline-hidden text-gray-12",
				props.class,
			)}
		/>
	);
}

const editorButtonStyles = cva(
	[
		"jk-button group flex flex-row items-center px-1.5 gap-1.5 h-8 rounded-lg text-[0.875rem]",
		"focus:outline-solid focus:outline-2 focus:outline-offset-2 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 transition-colors duration-100",
		"disabled:opacity-50 disabled:text-gray-11",
	],
	{
		variants: {
			variant: {
				primary:
					"text-gray-12 enabled:hover:not-data-pressed:bg-gray-3 data-expanded:bg-gray-3 outline-[var(--jk-focus)] focus:bg-transparent",
				danger:
					"text-gray-12 enabled:hover:not-data-pressed:bg-gray-3 data-expanded:bg-red-300 data-pressed:bg-red-300 data-expanded:text-gray-1 data-pressed:text-gray-1 outline-red-300",
			},
		},
		defaultVariants: { variant: "primary" },
	},
);

const editorButtonLeftIconStyles = cva("transition-colors duration-100", {
	variants: {
		variant: {
			primary:
				"text-gray-12 enabled:group-hover:not-data-group-disabled:text-gray-12 data-group-expanded:text-gray-12",
			danger:
				"text-gray-12 group-hover:enabled:text-gray-12 data-group-expanded:text-gray-1 data-group-pressed:text-gray-1",
		},
	},
	defaultVariants: { variant: "primary" },
});

type EditorButtonProps<T extends ValidComponent = "button"> =
	PolymorphicProps<T> & {
		children?: JSX.Element | string;
		leftIcon?: JSX.Element;
		rightIcon?: JSX.Element;
		kbd?: string[];
		tooltipText?: string;
		comingSoon?: boolean;
		rightIconEnd?: boolean;
	} & VariantProps<typeof editorButtonStyles>;

export function EditorButton<T extends ValidComponent = "button">(
	props: EditorButtonProps<T>,
) {
	const [local, cvaProps, others] = splitProps(
		mergeProps({ variant: "primary" }, props) as unknown as EditorButtonProps,
		[
			"children",
			"leftIcon",
			"rightIcon",
			"tooltipText",
			"kbd",
			"ref",
			"comingSoon",
			"rightIconEnd",
		],
		["class", "variant"],
	);

	const buttonContent = (
		<>
			<span class={editorButtonLeftIconStyles({ variant: cvaProps.variant })}>
				{local.leftIcon}
			</span>
			{local.children && <span>{local.children}</span>}
			{local.rightIcon && (
				<span class={local.rightIconEnd ? "ml-auto" : ""}>
					{local.rightIcon}
				</span>
			)}
		</>
	);

	return (
		<>
			{local.tooltipText || local.comingSoon ? (
				<Tooltip
					kbd={local.kbd}
					content={local.comingSoon ? localize("敬请期待") : local.tooltipText}
				>
					<Polymorphic
						as="button"
						{...others}
						ref={local.ref}
						class={cx(
							editorButtonStyles({ ...cvaProps, class: cvaProps.class }),
							local.rightIconEnd && "justify-between",
						)}
						disabled={local.comingSoon}
					>
						{buttonContent}
					</Polymorphic>
				</Tooltip>
			) : (
				<Polymorphic
					as="button"
					{...others}
					ref={local.ref}
					class={cx(
						editorButtonStyles({ ...cvaProps, class: cvaProps.class }),
						local.rightIconEnd && "justify-between",
					)}
				>
					{buttonContent}
				</Polymorphic>
			)}
		</>
	);
}
