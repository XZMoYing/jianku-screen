import Tooltip from "@corvu/tooltip";
import type { ParentProps } from "solid-js";

export function TooltipIconButton(
	props: ParentProps<{
		onClick: () => void;
		tooltipText: string;
		disabled?: boolean;
	}>,
) {
	return (
		<Tooltip>
			<Tooltip.Trigger
				onClick={(e: MouseEvent) => {
					e.stopPropagation();
					props.onClick();
				}}
				disabled={props.disabled}
				class="p-2.5 opacity-70 will-change-transform hover:opacity-100 rounded-full transition-all duration-200 hover:bg-gray-3 dark:hover:bg-gray-5 disabled:pointer-events-none disabled:opacity-45 disabled:hover:opacity-45"
			>
				{props.children}
			</Tooltip.Trigger>
			<Tooltip.Portal>
				<Tooltip.Content class="py-2 px-3 font-medium bg-gray-2 text-gray-12 border border-gray-3 text-xs rounded-lg animate-in fade-in slide-in-from-top-0.5">
					{props.tooltipText}
				</Tooltip.Content>
			</Tooltip.Portal>
		</Tooltip>
	);
}
