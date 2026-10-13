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
	const stage = async (value: string) => {
		results.stage = value;
		await emit("jianku-workspace-smoke-result", results);
	};
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
	const selectValue = async (label: string, value: string) => {
		const select = document.querySelector<HTMLSelectElement>(
			`select[aria-label="${label}"]`,
		);
		check(select, `${label}控件不存在`);
		if (!select) throw new Error(`${label}控件不存在`);
		select.value = value;
		select.dispatchEvent(new Event("change", { bubbles: true }));
		await new Promise((resolve) => setTimeout(resolve, 600));
	};
	const frameSize = async (width: number, height: number) => {
		const status = await commands.getPresentationStatus();
		return new Promise<{ width: number; height: number }>((resolve, reject) => {
			const socket = new WebSocket(`ws://127.0.0.1:${status.wsPort}/`);
			socket.binaryType = "arraybuffer";
			const timeout = setTimeout(() => {
				socket.close();
				reject(new Error(`未收到 ${width}×${height} 输出帧`));
			}, 10_000);
			socket.onmessage = (event: MessageEvent<ArrayBuffer>) => {
				const view = new DataView(event.data, event.data.byteLength - 24);
				const size = {
					width: view.getUint32(8, true),
					height: view.getUint32(4, true),
				};
				if (size.width === width && size.height === height) {
					clearTimeout(timeout);
					socket.close();
					resolve(size);
				}
			};
			socket.onerror = () => {
				clearTimeout(timeout);
				socket.close();
				reject(new Error("输出帧检查连接失败"));
			};
		});
	};
	try {
		await stage("initializing");
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
		const ratio = document.querySelector<HTMLSelectElement>(
			'select[aria-label="输出比例"]',
		);
		check(ratio?.options.length === 14, "输出比例选项不完整");
		results.aspectOptions = ratio?.options.length;
		await selectValue("输出比例", "square");
		await selectValue("输出清晰度", "3840");
		let configured = (await commands.getPresentationSetup()).options;
		check(
			configured.outputAspectRatio === "square" &&
				configured.outputWidth === 2160 &&
				configured.outputHeight === 2160,
			"方形 4K 画布没有保存",
		);
		await selectValue("输出比例", "vertical");
		await selectValue("输出清晰度", "1920");
		configured = (await commands.getPresentationSetup()).options;
		check(
			configured.outputWidth === 1080 && configured.outputHeight === 1920,
			"竖屏画布尺寸错误",
		);
		await selectValue("输出比例", "square");
		results.idleAspectAndQualitySaved = true;
		await stage("aspect-settings-saved");
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
		await stage("modes-switched");
		const scroll = await waitFor(() =>
			visible('[data-testid="presentation-scroll"]'),
		);
		check(scroll.scrollHeight > scroll.clientHeight, "演示页没有可滚动内容");
		scroll.scrollTop = scroll.scrollHeight;
		await new Promise((resolve) => setTimeout(resolve, 100));
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
		await stage("starting-square-output");
		button("开始演示")?.click();
		await waitFor(() => button("停止演示"), 25_000);
		await new Promise((resolve) => setTimeout(resolve, 1600));
		check((await commands.getPresentationStatus()).active, "演示未启动");
		check(ratio?.disabled, "运行中没有保护画布比例");
		results.squareFrame = await frameSize(1080, 1080);
		check(button("录屏")?.disabled, "运行中未保护模式切换");
		const windows = await getAllWebviewWindows();
		const output = windows.find(
			(window) => window.label === "presentation-output",
		);
		check(output, "未创建演示输出窗口");
		if (!output) throw new Error("未创建演示输出窗口");
		await output.setSize(new LogicalSize(720, 720));
		await new Promise((resolve) => setTimeout(resolve, 500));
		const fixedSize = await output.innerSize();
		check(
			Math.abs(fixedSize.width / fixedSize.height - 1) < 0.01,
			"共享窗口丢失固定比例",
		);
		results.fixedWindowRatio = fixedSize.width / fixedSize.height;
		await selectValue("输出清晰度", "1280");
		results.activeQualityFrame = await frameSize(720, 720);
		await stage("square-output-verified");
		const liveOptions = (await commands.getPresentationSetup()).options;
		check(
			liveOptions.outputResolution === 1280 &&
				liveOptions.outputAspectRatio === "square" &&
				liveOptions.outputWidth === 720 &&
				liveOptions.outputHeight === 720,
			"运行中读取到了过期的输出设置",
		);
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
		await selectValue("输出比例", "auto");
		await selectValue("输出清晰度", "1920");
		const fitted = (await commands.getPresentationSetup()).options;
		check(fitted.outputAspectRatio === null, "适合屏幕没有保存");
		button("开始演示")?.click();
		await waitFor(() => button("停止演示"), 25_000);
		results.fitScreenFrame = await frameSize(
			fitted.outputWidth,
			fitted.outputHeight,
		);
		const fittedOutput = (await getAllWebviewWindows()).find(
			(window) => window.label === "presentation-output",
		);
		if (!fittedOutput) throw new Error("适合屏幕输出窗口不存在");
		await fittedOutput.setSize(new LogicalSize(800, 450));
		results.fitWindowResizeFrame = await frameSize(1920, 1080);
		await stage("fit-output-verified");
		button("停止演示")?.click();
		await waitFor(() => button("开始演示"), 15_000);
		const restored = await commands.updatePresentation({
			...initial,
			outputAspectRatio: null,
			outputResolution: 1920,
		});
		await emit("presentation-options-changed", restored);
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
