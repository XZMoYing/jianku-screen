import { t as localize } from "~/utils/i18n";
import type { TimelineTrackType, useEditorContext } from "./context";

type AssociationCommands = Pick<
	ReturnType<typeof useEditorContext>["timelineCommands"],
	| "overlayAssociation"
	| "overlayAssociationTarget"
	| "setOverlayAttachment"
	| "setOverlayAttachmentTiming"
>;

export function overlayAssociationItems(
	commands: AssociationCommands,
	type: TimelineTrackType,
	index: () => number,
) {
	const association = commands.overlayAssociation(type, index());
	if (!association) return [];
	const clip = commands.overlayAssociationTarget();
	const attachment = association.attachment;
	const followsSpeed =
		attachment?.kind === "clip" && attachment.timing === "followClipSpeed";
	return [
		{
			label: clip
				? localize("Associate with {name}", { name: clip.name })
				: localize("Select a video clip or move the playhead onto one"),
			disabled:
				!clip ||
				(association.status === "attached" &&
					attachment?.kind === "clip" &&
					attachment.clipId === clip.id),
			run: () => {
				const current = index();
				if (clip && current >= 0)
					commands.setOverlayAttachment(type, current, clip.id);
			},
		},
		{
			label: localize(
				attachment?.kind === "clip"
					? "Unlink and keep current position"
					: "Keep timeline position",
			),
			disabled: association.status === "timeline",
			run: () => {
				const current = index();
				if (current >= 0) commands.setOverlayAttachment(type, current, null);
			},
		},
		...(association.canFollowSpeed && attachment?.kind === "clip"
			? [
					{
						label: localize(
							followsSpeed
								? "Keep overlay duration when speed changes"
								: "Follow clip speed",
						),
						run: () => {
							const current = index();
							if (current >= 0)
								commands.setOverlayAttachmentTiming(
									type,
									current,
									followsSpeed ? "preserveDuration" : "followClipSpeed",
								);
						},
					},
				]
			: []),
	];
}
