import assert from "node:assert/strict";
import test from "node:test";
import { registeredCopies, validMacBuildVersion } from "./jianku-install.mjs";

test("requires a build number whose changing component macOS actually compares", () => {
	assert.equal(validMacBuildVersion("2026.24.0"), true);
	assert.equal(validMacBuildVersion("2026.10.18.24"), false);
	assert.equal(validMacBuildVersion("0.2.0-alpha.24"), false);
	assert.equal(validMacBuildVersion(undefined), false);
});

test("unregisters duplicate builds without changing the installed app or other products", () => {
	const dump = [
		"path: /Applications/Jianku Screen Next.app (0x100)\nidentifier: com.jianku.screen.next",
		"path: /开发/alpha.20/Jianku Screen Next.app (0x101)\nidentifier: com.jianku.screen.next",
		"path: /Applications/Cap.app (0x102)\nidentifier: so.cap.desktop",
		"path: /Applications/Other.app (0x103)\nidentifier: com.jianku.screen.next.other",
	].join(
		"--------------------------------------------------------------------------------",
	);
	assert.deepEqual(
		registeredCopies(dump, "/Applications/Jianku Screen Next.app"),
		["/开发/alpha.20/Jianku Screen Next.app"],
	);
});

test("ignores document claims and incomplete registrations", () => {
	const dump = [
		"claim id: com.jianku.screen.next (0x200)\npath: /tmp/document (0x201)",
		"identifier: com.jianku.screen.next\nversionString: 24",
	].join(
		"--------------------------------------------------------------------------------",
	);
	assert.deepEqual(
		registeredCopies(dump, "/Applications/Jianku Screen Next.app"),
		[],
	);
});
