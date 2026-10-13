import { emit } from "@tauri-apps/api/event";
import { getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { commands } from "~/utils/tauri";

async function waitFor<T>(
	find: () => T | undefined | false,
	milliseconds = 12_000,
): Promise<T> {
	const deadline = performance.now() + milliseconds;
	while (performance.now() < deadline) {
		const value = find();
		if (value) return value;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error("工作台界面验证等待超时");
}

export async function runWorkspaceSmoke() {
	const enabled = (
		window as typeof window & { __CAP__?: { workspaceSmoke?: boolean } }
	).__CAP__?.workspaceSmoke;
	if (!enabled) return;
	const results: Record<string, unknown> = { userFramesSaved: false };
	const button = (text: string) =>
		Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
			(node) => node.textContent?.trim() === text,
		);
	const visible = (selector: string) => {
		const element = document.querySelector<HTMLElement>(selector);
		return element && element.getBoundingClientRect().height > 0
			? element
			: undefined;
	};
	const check = (value: unknown, message: string) => {
		if (!value) throw new Error(message);
	};
	try {
		check(
			(await commands.updatesCheck()) === null,
			"关闭配置没有阻止外部更新检查",
		);
		results.externalUpdaterDisabled = true;
		await waitFor(() => button("演示"));
		button("录屏")?.click();
		await waitFor(() => visible('[data-testid="recording-panel"]'));
		results.recordingVisible = true;
		button("手机与平板")?.click();
		await waitFor(() => visible('[data-testid="mobile-recorder"]'));
		const mobileSetup = await commands.getMobileSetup();
		results.mobileSourcePanel = {
			visible: !!visible('[data-testid="mobile-recorder"]'),
			deviceCount: mobileSetup.devices.length,
			iosHelperBundled: mobileSetup.iosReady,
			androidToolsFound: mobileSetup.androidReady,
		};
		check(mobileSetup.iosReady, "iOS 捕获组件未打包");
		button("电脑屏幕")?.click();
		await waitFor(() => !visible('[data-testid="mobile-recorder"]'));
		results.desktopSourceRestored = true;
		button("演示")?.click();
		await waitFor(() => visible('[data-testid="presentation-panel"]'));
		await waitFor(() =>
			document.querySelector('select[aria-label="演示来源"] option'),
		);
		const initial = (await commands.getPresentationSetup()).options;
		const padding = document.querySelector<HTMLInputElement>(
			'input[aria-label="留白"]',
		);
		check(padding, "留白控件不存在");
		if (!padding) return;
		padding.value = "18";
		padding.dispatchEvent(new Event("input", { bubbles: true }));
		await new Promise((resolve) => setTimeout(resolve, 500));
		check(
			(await commands.getPresentationSetup()).options.project.background
				.padding === 18,
			"待机设置没有保存",
		);
		button("录屏")?.click();
		await waitFor(() => visible('[data-testid="recording-panel"]'));
		button("演示")?.click();
		await waitFor(() => visible('[data-testid="presentation-panel"]'));
		check(
			document.querySelector<HTMLInputElement>('input[aria-label="留白"]')
				?.value === "18",
			"模式切换丢失设置",
		);
		results.settingsRetainedAcrossModeSwitch = true;
		const scroll = await waitFor(() =>
			visible('[data-testid="presentation-scroll"]'),
		);
		check(scroll.scrollHeight > scroll.clientHeight, "演示页没有可滚动内容");
		scroll.scrollTop = scroll.scrollHeight;
		await new Promise((resolve) => requestAnimationFrame(resolve));
		const footer = visible(
			'[data-testid="presentation-footer"]',
		)?.getBoundingClientRect();
		check(
			scroll.scrollTop > 0 && footer && footer.bottom <= window.innerHeight + 1,
			"滚动后操作栏不在可见区域",
		);
		results.scroll = {
			clientHeight: scroll.clientHeight,
			scrollHeight: scroll.scrollHeight,
			scrollTop: scroll.scrollTop,
			footerBottom: footer?.bottom,
			windowHeight: window.innerHeight,
		};
		button("开始演示")?.click();
		await waitFor(() => button("停止演示"), 25_000);
		await new Promise((resolve) => setTimeout(resolve, 1600));
		check((await commands.getPresentationStatus()).active, "演示未启动");
		check(button("录屏")?.disabled, "运行中未保护模式切换");
		const windows = await getAllWebviewWindows();
		check(
			!windows.some((window) => window.label === "presentation-controls"),
			"仍创建了额外控制窗口",
		);
		check(
			windows.some((window) => window.label === "presentation-output"),
			"未创建演示输出窗口",
		);
		results.activeWindowLabels = windows.map((window) => window.label);
		button("停止演示")?.click();
		await waitFor(() => button("开始演示"), 15_000);
		check(
			!(await commands.getPresentationStatus()).active,
			"停止演示未释放会话",
		);
		results.presentationStartStop = true;
		await commands.updatePresentation(initial);
		await emit("presentation-options-changed", initial);
		const nativeWindow = getCurrentWindow();
		await nativeWindow.setSize(new LogicalSize(660, 530));
		await new Promise((resolve) => setTimeout(resolve, 500));
		const narrowScroll = await waitFor(() =>
			visible('[data-testid="presentation-scroll"]'),
		);
		narrowScroll.scrollTop = narrowScroll.scrollHeight;
		const narrowFooter = visible(
			'[data-testid="presentation-footer"]',
		)?.getBoundingClientRect();
		check(
			narrowScroll.scrollTop > 0 &&
				narrowFooter &&
				narrowFooter.bottom <= window.innerHeight + 1,
			"小窗口底部不可达",
		);
		results.narrow = {
			width: window.innerWidth,
			height: window.innerHeight,
			scrollTop: narrowScroll.scrollTop,
			footerBottom: narrowFooter?.bottom,
		};
		await nativeWindow.setSize(new LogicalSize(860, 740));
		await new Promise((resolve) => setTimeout(resolve, 500));
		narrowScroll.scrollTop = 0;
		results.passed = true;
	} catch (error) {
		results.passed = false;
		results.error = String(error);
	}
	await emit("jianku-workspace-smoke-result", results);
}
