import { Show } from "solid-js";
import { t as localize } from "~/utils/i18n";
import IconLink from "~icons/lucide/link";
import { type TimelineTrackType, useEditorContext } from "./context";
import { createEditorContextMenu } from "./editor-context-menu";
import { overlayAssociationItems } from "./overlay-association-menu";
import { EditorButton } from "./ui";

export function OverlayAssociationControl(props: {
	type: TimelineTrackType;
	index: number;
}) {
	const { timelineCommands } = useEditorContext();
	const association = () =>
		timelineCommands.overlayAssociation(props.type, props.index);
	const menu = createEditorContextMenu();
	return (
		<Show when={association()}>
			{(current) => (
				<div class="min-w-0">
					<EditorButton
						class="max-w-full"
						leftIcon={<IconLink class="size-3.5" />}
						aria-label={localize("片段联动")}
						title={current().label}
						onClick={(event) => {
							const rows = (): readonly { start: number; end: number }[] =>
								timelineCommands.trackSegments(props.type) ?? [];
							const row = rows()[props.index];
							if (!row) return;
							menu.show(
								event,
								current().label,
								overlayAssociationItems(timelineCommands, props.type, () =>
									rows().indexOf(row),
								),
							);
						}}
					>
						<span class="truncate">{current().label}</span>
					</EditorButton>
					<menu.Content />
				</div>
			)}
		</Show>
	);
}
