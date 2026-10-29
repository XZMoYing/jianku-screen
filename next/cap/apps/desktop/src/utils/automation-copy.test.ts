import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	automationRuleDefaultName,
	automationRuleDisplayName,
	automationRuleSummary,
	automationTriggerExplanation,
	automationUnsupportedMessage,
} from "./automation-copy";
import type { AutomationRule, Trigger } from "./automations";
import { setInterfaceLanguage } from "./i18n";

vi.mock("~/store", () => ({ languageStore: { set: vi.fn(async () => {}) } }));
vi.stubGlobal("document", { documentElement: { lang: "zh-CN" } });
const triggers: Trigger[] = [
	"screenshotTaken",
	"studioRecordingFinished",
	"instantRecordingFinished",
	"recordingStarted",
	"uploadCompleted",
	"videoImported",
	"recordingDeleted",
];
const rule: Pick<AutomationRule, "name" | "trigger" | "actions"> = {
	name: "",
	trigger: "screenshotTaken",
	actions: [{ type: "openEditor" }],
};
beforeEach(async () => {
	await setInterfaceLanguage("zh-CN");
});
describe("automation display copy", () => {
	it.each(triggers)(
		"uses a complete sentence in the current language for %s",
		async (trigger) => {
			const chinese = automationTriggerExplanation(trigger);
			expect(chinese).toMatch(/^每次.+。$/);
			await setInterfaceLanguage("en");
			expect(automationTriggerExplanation(trigger)).toMatch(
				/^Runs whenever .+\.$/,
			);
			await setInterfaceLanguage("zh-CN");
			expect(automationTriggerExplanation(trigger)).toBe(chinese);
		},
	);
	it("updates generated names and summaries without caching the language", async () => {
		expect(automationRuleDefaultName(rule)).toBe("截图 → 编辑器");
		expect(automationRuleSummary(rule)).toBe("截图后 → 打开编辑器");
		await setInterfaceLanguage("en");
		expect(automationRuleDefaultName(rule)).toBe("Screenshot → Editor");
		expect(automationRuleSummary(rule)).toBe("Screenshot taken → Open editor");
	});
	it("keeps user-authored names intact in both languages", async () => {
		const named = { ...rule, name: "My Studio → 周报 001" };
		expect(automationRuleDisplayName(named)).toBe(named.name);
		await setInterfaceLanguage("en");
		expect(automationRuleDisplayName(named)).toBe(named.name);
	});
	it("handles no actions and multiple actions with localized punctuation", async () => {
		expect(automationRuleSummary({ ...rule, actions: [] })).toBe(
			"截图后 → 尚未添加操作",
		);
		expect(automationRuleDefaultName({ ...rule, actions: [] })).toBe(
			"截图自动化",
		);
		const multiple: typeof rule = {
			...rule,
			actions: [{ type: "openEditor" }, { type: "openFile" }],
		};
		expect(automationRuleSummary(multiple)).toBe(
			"截图后 → 打开编辑器、打开文件",
		);
		await setInterfaceLanguage("en");
		expect(automationRuleSummary(multiple)).toBe(
			"Screenshot taken → Open editor, Open file",
		);
	});
	it("formats unsupported action reports in the current language and keeps unknown identifiers", async () => {
		expect(automationUnsupportedMessage(["openEditor", "futureAction"])).toBe(
			"此设备不支持 2 项操作：打开编辑器、未知操作（futureAction）",
		);
		await setInterfaceLanguage("en");
		expect(automationUnsupportedMessage(["openEditor", "futureAction"])).toBe(
			"2 actions are not supported on this device: Open editor, Unknown action (futureAction)",
		);
	});
});
