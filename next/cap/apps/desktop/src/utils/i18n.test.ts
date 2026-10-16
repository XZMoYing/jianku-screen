import { describe, expect, it } from "vitest";
import { resolveLanguage, translate } from "./i18n";

describe("interface language", () => {
	it("uses explicit choices and resolves system language with a stable fallback", () => {
		expect(resolveLanguage("en", "zh-CN")).toBe("en");
		expect(resolveLanguage("zh-CN", "en-US")).toBe("zh-CN");
		expect(resolveLanguage("system", "zh-Hans-CN")).toBe("zh-CN");
		expect(resolveLanguage("system", "fr-FR")).toBe("en");
	});
	it("translates both legacy English and the newer Chinese interface", () => {
		expect(translate("Export", "zh-CN")).toBe("导出");
		expect(translate("画面比例", "en")).toBe("Aspect ratio");
		expect(
			translate("账号功能敬请期待，本地录制和编辑可正常使用。", "en"),
		).toContain("coming soon");
	});
	it("keeps technical formats intact and replaces upstream product branding", () => {
		expect(translate("SRT", "zh-CN")).toBe("SRT");
		for (const text of ["toString", "constructor", "__proto__"])
			expect(translate(text, "zh-CN")).toBe(text);
		expect(translate("Share via Cap cloud", "en")).toBe(
			"Share via Jianku Screen Next cloud",
		);
	});
});
