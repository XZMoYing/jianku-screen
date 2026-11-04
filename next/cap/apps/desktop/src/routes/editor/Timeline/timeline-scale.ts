import { type Accessor, createMemo } from "solid-js";

export function createTimelineScale(read: Accessor<number>) {
	return createMemo((previous: number) => {
		const value = read();
		return Number.isFinite(value) && value > 0 ? value : previous;
	}, 1);
}
