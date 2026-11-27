import { describe, expect, it } from "vitest";
import type { MainTrackGaps, TextSegment } from "~/utils/tauri";
import {
	atLastTimelineFrame,
	timelineOutputDuration,
	timelinePreviewFrame,
} from "./timeline-duration";

describe("editor output end", () => {
	it("ignores blank legacy tails and holds that belong to removed footage", () => {
		const timeline = {
			segments: [{ id: "video", start: 0, end: 238.01, timescale: 1 }],
			mainTrackGaps: { trailing: 1.91 } satisfies MainTrackGaps,
			transitions: [],
			textSegments: [
				{
					start: 239,
					end: 242,
					layout: "fullscreen",
					attachment: {
						kind: "clip",
						id: "old",
						clipId: "removed",
						sourceTime: 0,
					},
				},
			] satisfies TextSegment[],
		};
		expect(timelineOutputDuration(timeline)).toBe(238.01);
	});

	it("adds reachable holds and keeps independent titles and audio in output time", () => {
		const timeline = {
			segments: [{ start: 3, end: 7, timescale: 2 }],
			transitions: [],
			textSegments: [
				{ start: 1, end: 2, layout: "fullscreen" },
				{ start: 3, end: 4, layout: "fullscreen" },
			] satisfies TextSegment[],
			audioSegments: [{ start: 4, end: 5, path: "music.wav" }],
		};
		expect(timelineOutputDuration(timeline)).toBe(5);
		expect(timelineOutputDuration({ ...timeline, audioSegments: [] })).toBe(4);
		expect(
			timelineOutputDuration({
				...timeline,
				audioSegments: [],
				textSegments: [timeline.textSegments[0]],
			}),
		).toBe(3);
	});

	it("requests the final playable frame at and beyond exact and fractional boundaries", () => {
		expect(timelinePreviewFrame(9, 2, 30)).toBe(59);
		expect(timelinePreviewFrame(9, 2.001, 30)).toBe(60);
		expect(timelinePreviewFrame(1, 0, 30)).toBe(0);
		expect(atLastTimelineFrame(58 / 30, 2, 30)).toBe(false);
		expect(atLastTimelineFrame(59 / 30, 2, 30)).toBe(true);
	});
});
