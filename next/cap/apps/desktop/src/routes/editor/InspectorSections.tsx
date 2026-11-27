import { Tabs } from "@kobalte/core/tabs";
import {
	type Accessor,
	createSignal,
	createUniqueId,
	For,
	type JSX,
} from "solid-js";
import { MotionGroup, MotionSwitch } from "~/components/InterfaceMotion";
import { t as localize } from "~/utils/i18n";

export function InspectorSections<T extends string>(props: {
	label: string;
	tabs: readonly { id: T; label: string }[];
	initial: T;
	children: (active: Accessor<T>) => JSX.Element;
}) {
	const [section, setSection] = createSignal<T>(props.initial);
	const id = createUniqueId();
	return (
		<Tabs
			value={section()}
			onChange={(value) => {
				const tab = props.tabs.find((item) => item.id === value);
				if (tab) setSection(() => tab.id);
			}}
		>
			<Tabs.List aria-label={localize(props.label)}>
				<MotionGroup
					class="flex gap-1 rounded-xl bg-ed-ctl p-1"
					label={localize(props.label)}
				>
					<For each={props.tabs}>
						{(tab) => (
							<Tabs.Trigger
								id={`${id}-tab-${tab.id}`}
								aria-controls={`${id}-panel-${tab.id}`}
								value={tab.id}
								class="min-w-0 flex-1 rounded-lg px-1 py-1.5 text-xs text-ed-text-2"
							>
								{localize(tab.label)}
							</Tabs.Trigger>
						)}
					</For>
				</MotionGroup>
			</Tabs.List>
			<MotionSwitch value={section()} kind="subpage">
				{(active) => (
					<div
						id={`${id}-panel-${active()}`}
						aria-labelledby={`${id}-tab-${active()}`}
						role="tabpanel"
						class="pt-3"
					>
						{props.children(active)}
					</div>
				)}
			</MotionSwitch>
		</Tabs>
	);
}
