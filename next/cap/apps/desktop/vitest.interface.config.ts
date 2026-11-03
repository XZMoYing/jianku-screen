import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import icons from "unplugin-icons/vite";
import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

const solidPath = dirname(
	createRequire(import.meta.url).resolve("solid-js/package.json"),
);

export default defineConfig({
	plugins: [icons({ compiler: "solid" }), solid({ hot: false })],
	test: {
		environment: "jsdom",
		include: [
			"src/components/interface-controls.test.tsx",
			"src/components/device-choice-controls.test.tsx",
			"src/components/workspace-motion.test.tsx",
			"src/components/mobile-resource-view.test.tsx",
			"src/routes/editor/canvas-drag.test.tsx",
			"src/routes/editor/Timeline/hover-preview.test.tsx",
			"src/routes/editor/Timeline/segment-drag.test.tsx",
			"src/routes/editor/Timeline/keyboard-drag.test.tsx",
			"src/routes/editor/Timeline/three-d-drag.test.tsx",
			"src/routes/editor/Timeline/zoom-drag.test.tsx",
			"src/routes/editor/text-history.test.tsx",
			"src/routes/editor/text-drag.test.tsx",
			"src/routes/editor/auto-zoom-generation.test.ts",
		],
		server: {
			deps: {
				inline: [
					/solid-js/,
					/solid-[\w-]+/,
					/@kobalte/,
					/@solid-primitives/,
					/@corvu/,
				],
			},
		},
	},
	resolve: {
		alias: [
			{ find: "~", replacement: join(process.cwd(), "src") },
			{ find: /^solid-js$/, replacement: join(solidPath, "dist/solid.js") },
			{
				find: /^solid-js\/web$/,
				replacement: join(solidPath, "web/dist/web.js"),
			},
			{
				find: /^solid-js\/store$/,
				replacement: join(solidPath, "store/dist/store.js"),
			},
		],
	},
});
