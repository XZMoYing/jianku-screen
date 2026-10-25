import type { BookmarkLocation } from "~/utils/tauri";

export type BookmarkMarker = {
	id: string;
	label: string;
	number: number;
	time: number;
};

export function layoutBookmarkMarkers(
	bookmarks: BookmarkLocation[],
	start: number,
	secondsPerPixel: number,
	width: number,
) {
	const groups: { left: number; width: number; items: BookmarkMarker[] }[] = [];
	if (
		!Number.isFinite(secondsPerPixel) ||
		secondsPerPixel <= 0 ||
		!Number.isFinite(width) ||
		width <= 0
	)
		return groups;
	const fitGroup = (group: (typeof groups)[number]) => {
		group.width = Math.min(
			width,
			group.items.length === 1
				? 20
				: 24 + String(group.items.length).length * 7,
		);
		group.left = Math.min(group.left, Math.max(0, width - group.width));
	};
	const end = start + width * secondsPerPixel;
	const markers = bookmarks.flatMap((item, index) =>
		item.positions
			.filter((time) => Number.isFinite(time) && time >= start && time <= end)
			.map((time) => ({
				id: item.bookmark.id,
				label: item.bookmark.label,
				number: index + 1,
				time,
			})),
	);
	markers.sort((a, b) => a.time - b.time);
	for (const marker of markers) {
		const left = Math.max(
			0,
			Math.min((marker.time - start) / secondsPerPixel - 10, width - 20),
		);
		const last = groups.at(-1);
		if (last && left - last.left < last.width + 4) {
			last.items.push(marker);
			fitGroup(last);
		} else groups.push({ left, width: Math.min(width, 20), items: [marker] });
	}
	for (let index = groups.length - 1; index > 0; index--) {
		const current = groups[index];
		const previous = groups[index - 1];
		if (current.left < previous.left + previous.width + 4) {
			previous.items.push(...current.items);
			fitGroup(previous);
			groups.splice(index, 1);
		}
	}
	return groups;
}
