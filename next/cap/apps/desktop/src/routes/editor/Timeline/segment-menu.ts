import { t as localize } from "~/utils/i18n";
import { useEditorContext } from "../context";
import { createEditorContextMenu } from "../editor-context-menu";
import { overlayAssociationItems } from "../overlay-association-menu";
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
		const currentSelectionIndices = () =>
			targets.flatMap((target) => {
				const index = currentSegments().indexOf(target);
				return index >= 0 ? [index] : [];
			});
		const editSelection = (run: () => void) => {
			const indices = currentSelectionIndices();
			if (!indices.length) return;
			timelineCommands.selectSegments(type, indices);
			run();
		};
		const lane =
			type === "style" || type === "audio" || isOverlayTrackKind(type)
				? getSegmentTrack(segment)
				: undefined;
		const association = projectedZoom
			? null
			: timelineCommands.overlayAssociation?.(type, clickedIndex);

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
			...(!projectedZoom
				? [
						{
							label: localize("在播放头处分割"),
							shortcut: keymap.label("split"),
							disabled: !timelineCommands.canSplitOverlayAtPlayhead(
								type,
								indices,
							),
							run: () => editSelection(timelineCommands.splitAtPlayhead),
						},
					]
				: []),
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
						...overlayAssociationItems(timelineCommands, type, currentIndex),
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
				run: () => editSelection(timelineCommands.deleteSelection),
			},
		]);
		if (indices !== selectedIndices)
			timelineCommands.selectSegments(type, indices);
	}

	return { show, Content: menu.Content };
}
