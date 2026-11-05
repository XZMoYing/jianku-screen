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
		{ type, index, cancelGesture }: SegmentMenuTarget,
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
		menu.show(event, name, [
			{
				label: localize("编辑此片段属性"),
				run: () => {
					const target = currentIndex();
					if (target >= 0) timelineCommands.selectSegments(type, [target]);
				},
			},
			{
				label: localize("定位到片段开头"),
				run: () => {
					const target = currentIndex();
					if (target < 0) return;
					setEditorState("previewTime", null);
					moveTo(segment.start);
				},
			},
			{
				label: localize("选中此轨道的全部片段"),
				run: () => timelineCommands.selectTrack(type, lane),
			},
			{
				label:
					targets.length > 1
						? localize("删除 {count} 个片段", { count: targets.length })
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
