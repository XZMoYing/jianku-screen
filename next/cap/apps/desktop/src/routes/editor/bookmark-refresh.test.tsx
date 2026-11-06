import { createSignal, type Setter, Suspense } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	type BookmarkLocation,
	commands,
	type TimelineConfiguration,
} from "~/utils/tauri";
import { createRecordingBookmarks } from "./recording-bookmarks";
import { BookmarkTrack } from "./Timeline/BookmarkTrack";
import { defaultTextSegment } from "./text";
import { newCamera3DShot } from "./three-d";

vi.mock("solid-toast", () => ({ default: { error: vi.fn() } }));
vi.mock("~/utils/i18n", () => ({ t: (text: string) => text }));
vi.mock("~/utils/tauri", () => ({
	commands: {
		getRecordingBookmarks: vi.fn(),
		updateRecordingBookmark: vi.fn(),
		restoreRecordingBookmark: vi.fn(),
	},
}));
let context: {
	recordingBookmarks: ReturnType<typeof createRecordingBookmarks>;
	editorState: { timeline: { transform: { position: number } } };
};
vi.mock("./context", () => ({ useEditorContext: () => context }));
vi.mock("./Timeline/context", () => ({
	useTimelineContext: () => ({
		secsPerPixel: () => 0.01,
		timelineBounds: { width: 800 },
	}),
}));
const cleanups: Array<() => void> = [];
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const located = (time = 2): BookmarkLocation[] => [
	{
		bookmark: { id: "one", label: "重点", recordingSegment: 0, time: 2 },
		positions: [time],
	},
];
function deferred() {
	let resolve!: (value: BookmarkLocation[]) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<BookmarkLocation[]>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
function fixture(): TimelineConfiguration {
	return {
		segments: [
			{ id: "first", recordingSegment: 0, start: 0, end: 8, timescale: 1 },
			{ recordingSegment: 1, start: 0, end: 8, timescale: 1 },
		],
		transitions: [],
		zoomSegments: [],
		styleSegments: [],
		imageSegments: [],
		camera3dSegments: [newCamera3DShot(2, 6)],
		textSegments: [],
	};
}
function mount() {
	const host = document.createElement("div");
	document.body.append(host);
	let setTimeline!: Setter<TimelineConfiguration | null>;
	let session!: ReturnType<typeof createRecordingBookmarks>;
	const seek = vi.fn(async (_time: number) => {});
	const dispose = render(() => {
		const [timeline, setter] = createSignal<TimelineConfiguration | null>(
			fixture(),
		);
		setTimeline = setter;
		session = createRecordingBookmarks(timeline, seek);
		context = {
			recordingBookmarks: session,
			editorState: { timeline: { transform: { position: 0 } } },
		};
		return (
			<Suspense fallback={<div data-root-loading />}>
				<main data-editor-body>
					<BookmarkTrack gutter={100} />
				</main>
			</Suspense>
		);
	}, host);
	cleanups.push(dispose);
	return { host, setTimeline, session, seek };
}
beforeEach(() => {
	vi.mocked(commands.getRecordingBookmarks)
		.mockReset()
		.mockResolvedValue(located());
});
afterEach(() => {
	for (const dispose of cleanups.splice(0)) dispose();
	document.body.replaceChildren();
});

it("keeps the editor mounted during an initial slow bookmark read", async () => {
	const read = deferred();
	vi.mocked(commands.getRecordingBookmarks).mockImplementationOnce(
		() => read.promise,
	);
	const view = mount();
	await tick();
	expect(view.host.querySelector("[data-editor-body]")).not.toBeNull();
	expect(view.host.querySelector("[data-root-loading]")).toBeNull();
	expect(view.session.loading()).toBe(true);
	read.resolve(located());
	await vi.waitFor(() => expect(view.session.loading()).toBe(false));
});

it("keeps the real bookmark track and editor connected while remapping and prevents stale jumps", async () => {
	const view = mount();
	await vi.waitFor(() => expect(view.session.items()).toHaveLength(1));
	const body = view.host.querySelector("[data-editor-body]");
	expect(body).not.toBeNull();
	const read = deferred();
	vi.mocked(commands.getRecordingBookmarks).mockImplementationOnce(
		() => read.promise,
	);
	view.setTimeline(
		(value) =>
			value && {
				...value,
				segments: value.segments.map((clip, index) =>
					index ? clip : { ...clip, start: 1 },
				),
			},
	);
	await tick();
	expect(view.session.loading()).toBe(true);
	expect(body?.isConnected).toBe(true);
	expect(view.host.querySelector("[data-root-loading]")).toBeNull();
	expect(view.host.querySelector<HTMLButtonElement>("button")?.disabled).toBe(
		true,
	);
	expect(await view.session.jump(2)).toBe(false);
	expect(view.seek).not.toHaveBeenCalled();
	read.resolve(located(1));
	await vi.waitFor(() => expect(view.session.loading()).toBe(false));
	expect(await view.session.jump(1)).toBe(true);
	expect(view.seek).toHaveBeenCalledWith(1);
});

it("refreshes the visible bookmark after a gap moves its source clip", async () => {
	const view = mount();
	await vi.waitFor(() => expect(view.session.items()).toEqual(located()));
	vi.mocked(commands.getRecordingBookmarks).mockResolvedValueOnce(located(3));
	view.setTimeline(
		(value) =>
			value && {
				...value,
				mainTrackGaps: { beforeClip: { first: 1 } },
			},
	);
	await vi.waitFor(() => expect(view.session.items()).toEqual(located(3)));
	expect(await view.session.jump(3)).toBe(true);
	expect(view.seek).toHaveBeenCalledWith(3);
});

it("does not refetch bookmark positions during 3D movement or clip appearance edits", async () => {
	const view = mount();
	await vi.waitFor(() => expect(view.session.loading()).toBe(false));
	view.setTimeline(
		(value) => value && { ...value, camera3dSegments: [newCamera3DShot(3, 7)] },
	);
	await tick();
	view.setTimeline(
		(value) =>
			value && {
				...value,
				segments: value.segments.map((clip) => ({
					...clip,
					name: "演示",
					volume: 0.5,
					hideCursor: true,
				})),
			},
	);
	await tick();
	view.setTimeline(
		(value) =>
			value && {
				...value,
				textSegments: [
					{ ...defaultTextSegment(1, 3), content: "新文案", fontSize: 72 },
				],
			},
	);
	await tick();
	expect(commands.getRecordingBookmarks).toHaveBeenCalledTimes(1);
});

const mappingChanges: Array<
	[string, (timeline: TimelineConfiguration) => TimelineConfiguration]
> = [
	[
		"trim",
		(value) => ({
			...value,
			segments: value.segments.map((clip, i) =>
				i ? clip : { ...clip, start: 1 },
			),
		}),
	],
	[
		"speed",
		(value) => ({
			...value,
			segments: value.segments.map((clip, i) =>
				i ? clip : { ...clip, timescale: 2 },
			),
		}),
	],
	[
		"source",
		(value) => ({
			...value,
			segments: value.segments.map((clip, i) =>
				i ? clip : { ...clip, recordingSegment: 2 },
			),
		}),
	],
	["order", (value) => ({ ...value, segments: [...value.segments].reverse() })],
	[
		"transition",
		(value) => ({
			...value,
			transitions: [{ segmentIndex: 1, duration: 0.5, type: "cross-fade" }],
		}),
	],
	[
		"hold",
		(value) => ({
			...value,
			textSegments: [{ ...defaultTextSegment(1, 3), layout: "fullscreen" }],
		}),
	],
];
it.each(mappingChanges)(
	"refreshes bookmark mapping after %s changes",
	async (_name, change) => {
		const view = mount();
		await vi.waitFor(() => expect(view.session.loading()).toBe(false));
		view.setTimeline((value) => value && change(value));
		await tick();
		expect(commands.getRecordingBookmarks).toHaveBeenCalledTimes(2);
	},
);

it("keeps late old results from replacing a newer timeline mapping", async () => {
	const view = mount();
	await vi.waitFor(() => expect(view.session.loading()).toBe(false));
	const old = deferred();
	const current = deferred();
	vi.mocked(commands.getRecordingBookmarks)
		.mockImplementationOnce(() => old.promise)
		.mockImplementationOnce(() => current.promise);
	view.setTimeline((value) => value && mappingChanges[0][1](value));
	await tick();
	view.setTimeline((value) => value && mappingChanges[1][1](value));
	await tick();
	current.resolve(located(1));
	await vi.waitFor(() =>
		expect(view.session.items()?.[0].positions).toEqual([1]),
	);
	old.resolve(located(6));
	await tick();
	expect(view.session.items()?.[0].positions).toEqual([1]);
	expect(view.host.querySelector("[data-editor-body]")).not.toBeNull();
	expect(view.host.querySelector("[data-root-loading]")).toBeNull();
});

it("refreshes explicitly with a complete current snapshot and keeps read failures local", async () => {
	const view = mount();
	await vi.waitFor(() => expect(view.session.loading()).toBe(false));
	view.setTimeline(
		(value) => value && { ...value, camera3dSegments: [newCamera3DShot(3, 7)] },
	);
	await tick();
	vi.mocked(commands.getRecordingBookmarks).mockRejectedValueOnce(
		new Error("read failed"),
	);
	expect(await view.session.refresh()).toBe(false);
	expect(view.session.error()).toBe("read failed");
	expect(view.host.querySelector("[data-editor-body]")).not.toBeNull();
	expect(await view.session.refresh()).toBe(true);
	expect(
		vi.mocked(commands.getRecordingBookmarks).mock.calls.at(-1)?.[0]
			.camera3dSegments?.[0].start,
	).toBe(3);
	expect(view.session.error()).toBeUndefined();
});
