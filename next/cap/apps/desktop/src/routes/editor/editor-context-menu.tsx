import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import { createSignal, For, Show } from "solid-js";
import { MenuItem, PopperContent, topLeftAnimateClasses } from "./ui";

type MenuEntry = {
	label: string;
	shortcut?: string;
	disabled?: boolean;
	danger?: boolean;
	run: () => void;
};

export function isContextMenuKey(event: KeyboardEvent) {
	return (
		!event.defaultPrevented &&
		!event.altKey &&
		!event.ctrlKey &&
		!event.metaKey &&
		(event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey))
	);
}

export function createEditorContextMenu() {
	const [open, setOpen] = createSignal(false);
	const [anchor, setAnchor] = createSignal({ x: 0, y: 0 });
	const [items, setItems] = createSignal<MenuEntry[]>([]);
	const [label, setLabel] = createSignal("");
	let returnFocus: HTMLElement | undefined;

	function show(
		event: MouseEvent | KeyboardEvent,
		name: string,
		entries: MenuEntry[],
	) {
		if (event.defaultPrevented) return;
		const trigger = event.currentTarget;
		if (!(trigger instanceof HTMLElement)) return;
		event.preventDefault();
		event.stopPropagation();

		if (
			"clientX" in event &&
			(event.button !== 0 || event.clientX || event.clientY)
		) {
			setAnchor({ x: event.clientX, y: event.clientY });
			returnFocus =
				document.activeElement instanceof HTMLElement
					? document.activeElement
					: undefined;
		} else {
			const bounds = trigger.getBoundingClientRect();
			setAnchor({ x: bounds.left, y: bounds.bottom });
			returnFocus = trigger;
		}
		setLabel(name);
		setItems(entries);
		setOpen(true);
	}

	function Content() {
		return (
			<DropdownMenu
				modal={false}
				open={open()}
				onOpenChange={setOpen}
				getAnchorRect={anchor}
				gutter={3}
				placement="bottom-start"
			>
				<DropdownMenu.Portal>
					<PopperContent<typeof DropdownMenu.Content>
						as={DropdownMenu.Content}
						class={`min-w-44 gap-0.5 p-1.5 ${topLeftAnimateClasses}`}
						aria-label={label()}
						onMouseDown={(event) => event.stopPropagation()}
						onEscapeKeyDown={() => {
							const target = returnFocus;
							queueMicrotask(() => target?.focus({ preventScroll: true }));
						}}
					>
						<For each={items()}>
							{(item) => (
								<MenuItem<typeof DropdownMenu.Item>
									as={DropdownMenu.Item}
									class={
										item.danger
											? "text-red-9 data-highlighted:text-red-10"
											: undefined
									}
									disabled={item.disabled}
									onSelect={item.run}
								>
									<span class="flex-1">{item.label}</span>
									<Show when={item.shortcut}>
										<kbd class="ml-3 text-[11px] text-ed-text-3">
											{item.shortcut}
										</kbd>
									</Show>
								</MenuItem>
							)}
						</For>
					</PopperContent>
				</DropdownMenu.Portal>
			</DropdownMenu>
		);
	}

	return { show, Content };
}
