import { describe, expect, it } from "vitest";
import { layoutBookmarkMarkers } from "./bookmark-markers";

const located = (id: string, positions: number[]) => ({
	bookmark: { id, label: id, time: 0, recordingSegment: 0 },
	positions,
});

describe("recording bookmark markers", () => {
	it("keeps duplicated source positions, omits cuts and clips to the visible range", () => {
		const groups = layoutBookmarkMarkers(
			[located("cut", []), located("repeat", [1, 5, 9]), located("other", [6])],
			4,
			0.01,
			300,
		);
		expect(groups.map((group) => group.items.map((item) => item.time))).toEqual(
			[[5], [6]],
		);
		expect(groups[0].items[0].number).toBe(2);
		expect(groups.map((group) => group.left)).toEqual([90, 190]);
	});

	it("groups dense markers without losing their times or labels", () => {
		const groups = layoutBookmarkMarkers(
			[
				located("third", [0.2]),
				located("first", [0]),
				located("second", [0.1]),
			],
			0,
			0.1,
			400,
		);
		expect(groups).toHaveLength(1);
		expect(groups[0].left).toBe(0);
		expect(groups[0].items.map((item) => item.id)).toEqual([
			"first",
			"second",
			"third",
		]);
	});

	it("keeps end markers accessible and handles an unmeasured timeline", () => {
		expect(
			layoutBookmarkMarkers([located("end", [10])], 0, 0.1, 100)[0].left,
		).toBe(80);
		for (const scale of [0, -1, Number.NaN])
			expect(
				layoutBookmarkMarkers([located("first", [0])], 0, scale, 100),
			).toEqual([]);
		expect(layoutBookmarkMarkers([located("first", [0])], 0, 0.1, 0)).toEqual(
			[],
		);
	});

	it("reserves space for the count badge and merges groups clipped against the end", () => {
		const groups = layoutBookmarkMarkers(
			[located("end", [6.5, 9, 9.5, 10])],
			0,
			0.1,
			100,
		);
		expect(groups).toHaveLength(1);
		expect(groups[0].items).toHaveLength(4);
		for (const group of groups) {
			expect(group.left).toBeGreaterThanOrEqual(0);
			expect(group.left + group.width).toBeLessThanOrEqual(100);
		}
		const many = layoutBookmarkMarkers(
			Array.from({ length: 120 }, (_, index) =>
				located(String(index), [index / 10]),
			),
			0,
			0.04,
			400,
		);
		for (let index = 1; index < many.length; index++)
			expect(many[index].left).toBeGreaterThanOrEqual(
				many[index - 1].left + many[index - 1].width + 4,
			);
		expect(many.flatMap((group) => group.items)).toHaveLength(120);
	});
});
