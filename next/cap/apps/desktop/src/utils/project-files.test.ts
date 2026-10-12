import { describe, expect, it } from "vitest";
import { projectAssetPath, projectCopyName } from "./project-files";

describe("portable project paths", () => {
	it("resolves moved project assets with spaces without modifying absolute paths", () => {
		expect(projectAssetPath("/moved/demo.cap/", "assets/my image.png")).toBe(
			"/moved/demo.cap/assets/my image.png",
		);
		expect(projectAssetPath("/demo.cap", "/outside/image.png")).toBe(
			"/outside/image.png",
		);
		expect(projectAssetPath("C:\\demo.cap", "D:\\image.png")).toBe(
			"D:\\image.png",
		);
		expect(
			projectAssetPath("C:/demo.cap", "\\\\server\\share\\image.png"),
		).toBe("\\\\server\\share\\image.png");
	});

	it("supports the existing stored asset URL forms", () => {
		expect(
			projectAssetPath("/demo.cap", "asset://localhost/Users/demo/image.png"),
		).toBe("/Users/demo/image.png");
		expect(
			projectAssetPath("/demo.cap", "asset://localhost//Users/demo/image.png"),
		).toBe("//Users/demo/image.png");
		expect(
			projectAssetPath("/demo.cap", "asset://assets/portable/image.png"),
		).toBe("/demo.cap/assets/portable/image.png");
	});

	it("keeps Unicode titles and removes unsafe filename characters", () => {
		expect(projectCopyName(" 演示项目.CAP ".trim())).toBe("演示项目 副本.cap");
		expect(projectCopyName("a/b:c\n\u0000d?e")).toBe("a_b_c__d_e 副本.cap");
		expect(projectCopyName("   ")).toBe("简库工程 副本.cap");
	});

	it("limits long Unicode filenames by UTF-8 bytes without splitting characters", () => {
		const name = projectCopyName("演示🎬".repeat(100));
		expect(new TextEncoder().encode(name).length).toBeLessThan(200);
		expect(name.endsWith(" 副本.cap")).toBe(true);
		expect(name.includes("\ufffd")).toBe(false);
	});
});
