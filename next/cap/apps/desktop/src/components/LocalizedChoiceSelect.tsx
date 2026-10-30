import { createMemo } from "solid-js";
import { t } from "~/utils/i18n";
import { ChoiceSelect } from "./ChoiceSelect";

export function LocalizedChoiceSelect<T extends string | number>(props: {
	value: T;
	options: readonly { value: T; label: string; disabled?: boolean }[];
	onChange: (value: T) => void;
	class?: string;
	disabled?: boolean;
	preserveLabels?: boolean;
	triggerRef?: (element: HTMLButtonElement) => void;
	"aria-label"?: string;
}) {
	const options = createMemo(() => {
		const choices = props.options.map((option) => ({
			...option,
			label: props.preserveLabels ? option.label : t(option.label),
		}));
		if (!choices.some((option) => option.value === props.value))
			choices.unshift({
				value: props.value,
				label: String(props.value),
				disabled: true,
			});
		return choices;
	});
	return (
		<ChoiceSelect
			triggerRef={props.triggerRef}
			value={props.value}
			options={options()}
			class={props.class}
			disabled={props.disabled}
			aria-label={props["aria-label"]}
			onChange={(value) => {
				const option = props.options.find(
					(option) => String(option.value) === value,
				);
				if (option && !option.disabled && option.value !== props.value)
					props.onChange(option.value);
			}}
		/>
	);
}
