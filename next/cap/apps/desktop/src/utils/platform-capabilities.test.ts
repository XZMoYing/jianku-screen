import { expect, it, vi } from "vitest";
import { supportsScreenshotOcr } from "./platform-capabilities";

const { ostype } = vi.hoisted(() => ({ ostype: vi.fn() }));
vi.mock("@tauri-apps/plugin-os", () => ({ type: ostype }));

it.each([
	["macos", true],
	["windows", true],
	["linux", false],
	["android", false],
])(
	"reports native screenshot OCR availability for %s",
	(platform, expected) => {
		ostype.mockReturnValue(platform);
		expect(supportsScreenshotOcr()).toBe(expected);
	},
);
