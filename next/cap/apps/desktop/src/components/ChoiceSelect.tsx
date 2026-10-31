import { Select } from "@kobalte/core/select";
import {
	createEffect,
	createMemo,
	createSignal,
	type JSX,
	onCleanup,
	onMount,
} from "solid-js";
import { MenuItem, MenuItemList, PopperContent } from "~/routes/editor/ui";
import { useMotionInteraction } from "./InterfaceMotion";
import { MotionText } from "./MotionText";

export type ChoiceOption = {
	value: string | number;
	label: string;
	disabled?: boolean;
};

export function ChoiceSelect(props: {
	options: readonly ChoiceOption[];
	value?: string | number | null;
	onChange: (value: string) => void;
	disabled?: boolean;
	id?: string;
	class?: string;
	style?: JSX.CSSProperties;
	triggerRef?: (element: HTMLButtonElement) => void;
	"aria-label"?: string;
}) {
	let root!: HTMLDivElement;
	const [open, setOpen] = createSignal(false);
	const [fieldsetDisabled, setFieldsetDisabled] = createSignal(false);
	const interactive = useMotionInteraction();
	const disabled = () => props.disabled || fieldsetDisabled() || !interactive();
	createEffect(() => {
		if (disabled()) setOpen(false);
	});
	onMount(() => {
		const fieldset = root.closest("fieldset");
		if (!fieldset) return;
		const update = () => setFieldsetDisabled(fieldset.disabled);
		const observer = new MutationObserver(update);
		observer.observe(fieldset, {
			attributes: true,
			attributeFilter: ["disabled"],
		});
		update();
		onCleanup(() => observer.disconnect());
	});
	const options = createMemo(() =>
		props.options.map((option) => ({ ...option, value: String(option.value) })),
	);
	const selected = createMemo(() =>
		options().find((option) => option.value === String(props.value ?? "")),
	);
	return (
		<Select
			ref={root}
			open={open()}
			onOpenChange={(value) => setOpen(value && !disabled())}
			class="jk-choice"
			options={options()}
			optionValue="value"
			optionTextValue="label"
			optionDisabled="disabled"
			value={selected() ?? null}
			disabled={disabled()}
			onChange={(option) => {
				if (option && !option.disabled && !disabled())
					props.onChange(option.value);
			}}
			itemComponent={(item) => (
				<MenuItem<typeof Select.Item>
					as={Select.Item}
					item={item.item}
					class="jk-choice-option"
				>
					<Select.ItemLabel>{item.item.rawValue.label}</Select.ItemLabel>
					<Select.ItemIndicator class="jk-choice-check">✓</Select.ItemIndicator>
				</MenuItem>
			)}
		>
			<Select.Trigger
				ref={(element) => props.triggerRef?.(element)}
				id={props.id}
				aria-label={props["aria-label"]}
				class={`jk-choice-trigger ${props.class ?? ""}`}
				style={props.style}
				onClick={(event) => {
					if (
						event.detail === 0 &&
						event.currentTarget.dataset.pointerType !== "touch" &&
						!disabled()
					)
						setOpen((value) => !value);
				}}
			>
				<Select.Value<ChoiceOption>>
					{(state) => <MotionText text={state.selectedOption()?.label ?? ""} />}
				</Select.Value>
				<Select.Icon class="jk-choice-chevron" aria-hidden="true">
					<svg viewBox="0 0 16 16" fill="none">
						<path
							d="m4 6 4 4 4-4"
							stroke="currentColor"
							stroke-width="1.8"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
				</Select.Icon>
			</Select.Trigger>
			<Select.Portal>
				<PopperContent<typeof Select.Content>
					as={Select.Content}
					class="jk-choice-menu"
					onCloseAutoFocus={(event) => {
						if (!interactive()) event.preventDefault();
					}}
				>
					<MenuItemList<typeof Select.Listbox> as={Select.Listbox} />
				</PopperContent>
			</Select.Portal>
		</Select>
	);
}
