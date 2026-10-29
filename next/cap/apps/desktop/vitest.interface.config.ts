import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

const solidPath = dirname(
	createRequire(import.meta.url).resolve("solid-js/package.json"),
);

export default defineConfig({
	plugins: [solid({ hot: false })],
	test: {
		environment: "jsdom",
		include: ["src/components/interface-controls.test.tsx"],
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
