// @refresh reload
import { createHandler, StartServer } from "@solidjs/start/server";

export default createHandler(() => (
	<StartServer
		document={({ assets, children, scripts }) => (
			<html lang="zh-CN" class="overflow-hidden h-full">
				<head>
					<meta charset="utf-8" />
					<meta name="viewport" content="width=device-width, initial-scale=1" />
					<link rel="icon" type="image/svg+xml" href="/assets/logo.svg" />
					<script
						innerHTML={`
							(function() {
								var theme = null;
								try { theme = localStorage.getItem('cap-theme'); } catch (e) {}
								var isDark = theme === 'dark' ||
									(theme === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
								if (isDark) document.documentElement.classList.add('dark');
								try {
									var palette = JSON.parse(localStorage.getItem('jianku-color-css') || 'null');
									var colors = palette && palette[isDark ? 'dark' : 'light'];
									if (colors) Object.entries(colors).forEach(function(entry) {
										if (/^--jk-[a-z-]+$/.test(entry[0]) && /^#[0-9a-f]{6}$/i.test(entry[1])) {
											document.documentElement.style.setProperty(entry[0], entry[1]);
										}
									});
								} catch (e) {}
							})();
						`}
					/>
					{assets}
				</head>
				<body class="w-screen h-screen cursor-default select-none">
					<div id="app" class="h-full text-(--text-primary)">
						{children}
					</div>
					{scripts}
				</body>
			</html>
		)}
	/>
));
