import { emit } from "@tauri-apps/api/event";
import { getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { commands } from "~/utils/tauri";

export async function runMobileRecoverySmoke() {
	const metrics: Record<string, unknown> = {
		synthetic: true,
		deviceCaptureStarted: false,
	};
	const stage = async (value: string) => {
		metrics.stage = value;
		await emit("jianku-mobile-recovery-smoke-result", metrics);
	};
	const waitFor = async <T>(
		find: () => Promise<T | false | undefined> | T | false | undefined,
	): Promise<T> => {
		const deadline = performance.now() + 25_000;
		while (performance.now() < deadline) {
			const value = await find();
			if (value) return value;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		throw new Error("设备录制恢复界面验证等待超时");
	};
	const button = (text: string, root: ParentNode = document) =>
		Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(
			(node) => node.textContent?.trim() === text,
		);
	try {
		await stage("initializing");
		(await waitFor(() => button("录屏"))).click();
		(await waitFor(() => button("手机与平板"))).click();
		const project = (await commands.listMobileProjects()).find(
			(project) => project.name === "简库恢复合成验证",
		);
		if (!project) throw new Error("未找到专用合成验证工程");
		metrics.initialPhase = project.phase;
		const findRow = () =>
			Array.from(
				document.querySelectorAll<HTMLElement>(".mobile-history-row"),
			).find((node) => node.dataset.projectPath === project.path);
		const row = await waitFor(findRow);
		if (project.phase !== "complete") {
			const recover = button("恢复并编辑", row);
			if (!recover || recover.disabled) throw new Error("恢复按钮不可用");
			await stage("recovering");
			recover.click();
			await waitFor(async () => {
				const status = await commands.getMobileStatus();
				if (status.phase === "failed")
					throw new Error(status.error ?? "恢复失败");
				return status.phase === "complete" && !status.active;
			});
			metrics.recoveredViaUi = true;
		} else {
			const edit = button("继续编辑", row);
			if (!edit || edit.disabled) throw new Error("重启后的编辑入口不可用");
			edit.click();
			metrics.reopenedAfterRestart = true;
		}
		await waitFor(async () =>
			(await getAllWebviewWindows()).some((window) =>
				window.label.startsWith("editor"),
			),
		);
		metrics.editorOpened = true;
		const listed = (await commands.listMobileProjects()).find(
			(item) => item.path === project.path,
		);
		if (listed?.phase !== "complete") throw new Error("列表没有更新为已保存");
		await waitFor(() => {
			const row = findRow();
			return row && button("继续编辑", row);
		});
		metrics.listUpdated = true;
		await commands.recoverRecording(project.path);
		metrics.editorRecoveryCommandSupportsMobile = true;
		await getCurrentWindow().setSize(new LogicalSize(660, 530));
		await new Promise((resolve) => setTimeout(resolve, 250));
		const scroll = document.querySelector<HTMLElement>(".mobile-recorder");
		if (!scroll) throw new Error("设备页面没有滚动容器");
		scroll.scrollTop = scroll.scrollHeight;
		await new Promise((resolve) => setTimeout(resolve, 100));
		const history = document.querySelector<HTMLElement>(".mobile-history");
		metrics.narrowWindow = {
			scrollTop: scroll.scrollTop,
			scrollHeight: scroll.scrollHeight,
			clientHeight: scroll.clientHeight,
			historyWidth: history?.clientWidth,
			windowWidth: window.innerWidth,
		};
		if (
			!scroll.scrollTop ||
			(history?.scrollWidth ?? 0) > (history?.clientWidth ?? 0) + 1
		)
			throw new Error("较小窗口中列表无法正常滚动或宽度溢出");
		await getCurrentWindow().setSize(new LogicalSize(860, 740));
		metrics.ok = true;
		await stage("complete");
	} catch (error) {
		metrics.ok = false;
		metrics.error = String(error);
		await stage("failed");
	}
}
