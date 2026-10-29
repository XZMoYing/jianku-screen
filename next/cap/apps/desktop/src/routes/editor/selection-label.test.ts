import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setInterfaceLanguage } from "~/utils/i18n";
import {
	type SelectableSegmentKind,
	selectedSegmentLabel,
} from "./selection-label";

vi.mock("~/store", () => ({
	languageStore: { set: vi.fn(async () => undefined) },
}));

beforeEach(async () => {
	vi.stubGlobal("document", { documentElement: { lang: "zh-CN" } });
	await setInterfaceLanguage("zh-CN");
});

afterEach(() => vi.unstubAllGlobals());

const examples: Array<[SelectableSegmentKind, string, string]> = [
	["caption", "字幕", "caption"],
	["keyboard", "按键片段", "keyboard"],
	["text", "文字片段", "text"],
	["audio", "音频片段", "audio"],
	["mask", "遮罩片段", "mask"],
	["scene", "场景片段", "scene"],
];

describe("selection summaries", () => {
	it.each(examples)(
		"formats %s counts using the current interface language",
		async (kind, chinese, english) => {
			const measure = kind === "caption" ? "条" : "个";
			expect(selectedSegmentLabel(kind, 2)).toBe(
				`已选择 2 ${measure}${chinese}`,
			);
			await setInterfaceLanguage("en");
			expect(selectedSegmentLabel(kind, 1)).toBe(
				`1 ${english} segment selected`,
			);
			expect(selectedSegmentLabel(kind, 2)).toBe(
				`2 ${english} segments selected`,
			);
			expect(selectedSegmentLabel(kind, 0)).toBe(
				`0 ${english} segments selected`,
			);
			await setInterfaceLanguage("zh-CN");
			expect(selectedSegmentLabel(kind, 12)).toBe(
				`已选择 12 ${measure}${chinese}`,
			);
		},
	);
});
