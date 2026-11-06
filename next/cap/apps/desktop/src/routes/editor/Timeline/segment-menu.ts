import { t as localize } from "~/utils/i18n";
import { useEditorContext } from "../context";
import { createEditorContextMenu } from "../editor-context-menu";
import { getSegmentTrack, isOverlayTrackKind } from "../timelineTracks";
import type { SegmentMenuTarget } from "./context";

export function createTimelineSegmentMenu(moveTo: (time: number) => void) {
	const { editorState, setEditorState, keymap, timelineCommands } =
		useEditorContext();
	const menu = createEditorContextMenu();

	function show(
		event: MouseEvent | KeyboardEvent,
		{ type, index, cancelGesture, projectedZoom }: SegmentMenuTarget,
		name: string,
	) {
		if (event.defaultPrevented) return;
		const currentSegments = (): readonly {
			start: number;
			end: number;
			track?: number;
		}[] => timelineCommands.trackSegments(type) ?? [];
		const segment = currentSegments()[index];
		if (!segment) return;
		cancelGesture?.();

		const segments = currentSegments();
		const clickedIndex = segments.indexOf(segment);
		if (clickedIndex < 0) return;
		const selection = editorState.timeline.selection;
		const selectedIndices =
			selection?.type === type ? selection.indices : undefined;
		const indices = selectedIndices?.includes(clickedIndex)
			? selectedIndices
			: [clickedIndex];
		const targets = indices.flatMap((target) =>
			segments[target] ? [segments[target]] : [],
		);
		const currentIndex = () => currentSegments().indexOf(segment);
		const lane =
			type === "style" || type === "audio" || isOverlayTrackKind(type)
				? getSegmentTrack(segment)
				: undefined;
		const association = projectedZoom
			? null
			: timelineCommands.overlayAssociation?.(type, clickedIndex);
		const clip = association
			? timelineCommands.overlayAssociationTarget()
			: null;
		const playhead = editorState.playbackTime;
		menu.show(event, name, [
			{
				label: projectedZoom
					? localize("Edit zoom group")
					: localize("编辑此片段属性"),
				run: () => {
					const target = currentIndex();
					if (target >= 0) timelineCommands.selectSegments(type, [target]);
				},
			},
			{
				label: projectedZoom
					? localize("Go to zoom slice start")
					: localize("定位到片段开头"),
				disabled: projectedZoom?.start === null,
				run: () => {
					const target = currentIndex();
					if (target < 0 || projectedZoom?.start === null) return;
					setEditorState("previewTime", null);
					moveTo(projectedZoom?.start ?? segment.start);
				},
			},
			{
				label: localize("选中此轨道的全部片段"),
				run: () => timelineCommands.selectTrack(type, lane),
			},
			...(projectedZoom
				? [
						{ label: projectedZoom.label, disabled: true, run: () => {} },
						...(projectedZoom.splitAt
							? [
									{
										label: localize("Split zoom slice at playhead"),
										disabled: !projectedZoom.canSplitAt?.(playhead),
										run: () => projectedZoom.splitAt?.(playhead),
									},
								]
							: []),
						...(projectedZoom.resetOffset
							? [
									{
										label: localize("Reset zoom slice alignment"),
										run: projectedZoom.resetOffset,
									},
								]
							: []),
					]
				: []),
			...(association
				? [
						{ label: association.label, disabled: true, run: () => {} },
						{
							label: clip
								? localize("Associate with {name}", { name: clip.name })
								: localize("Select a video clip or move the playhead onto one"),
							disabled:
								!clip ||
								(association.status === "attached" &&
									association.attachment?.kind === "clip" &&
									association.attachment.clipId === clip.id),
							run: () => {
								const index = currentIndex();
								if (index >= 0 && clip)
									timelineCommands.setOverlayAttachment(type, index, clip.id);
							},
						},
						{
							label: localize(
								association.attachment?.kind === "clip"
									? "Unlink and keep current position"
									: "Keep timeline position",
							),
							disabled: association.status === "timeline",
							run: () => {
								const index = currentIndex();
								if (index >= 0)
									timelineCommands.setOverlayAttachment(type, index, null);
							},
						},
						...(association.canFollowSpeed &&
						association.attachment?.kind === "clip"
							? [
									{
										label: localize(
											association.attachment.timing === "followClipSpeed"
												? "Keep overlay duration when speed changes"
												: "Follow clip speed",
										),
										run: () => {
											const index = currentIndex();
											if (index >= 0)
												timelineCommands.setOverlayAttachmentTiming(
													type,
													index,
													association.attachment?.kind === "clip" &&
														association.attachment.timing === "followClipSpeed"
														? "preserveDuration"
														: "followClipSpeed",
												);
										},
									},
								]
							: []),
					]
				: []),
			{
				label:
					targets.length > 1
						? localize("删除 {count} 个片段", { count: targets.length })
						: projectedZoom
							? localize("Delete zoom group")
							: localize("删除此片段"),
				shortcut: keymap.label("delete"),
				danger: true,
				run: () => {
					const current = currentSegments();
					const selected = targets.flatMap((target) => {
						const index = current.indexOf(target);
						return index >= 0 ? [index] : [];
					});
					if (!selected.length) return;
					timelineCommands.selectSegments(type, selected);
					timelineCommands.deleteSelection();
				},
			},
		]);
		if (indices !== selectedIndices)
			timelineCommands.selectSegments(type, indices);
	}

	return { show, Content: menu.Content };
}
