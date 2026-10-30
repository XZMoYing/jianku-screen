import { Button } from "@cap/ui-solid";
import { action, useAction, useSubmission } from "@solidjs/router";
import { confirm } from "@tauri-apps/plugin-dialog";
import { createResource, createSignal, For, Show } from "solid-js";
import toast from "solid-toast";
import { LocalizedChoiceSelect } from "~/components/LocalizedChoiceSelect";
import { MotionText } from "~/components/MotionText";
import { showAccountComingSoon } from "~/utils/auth";
import { t as localize } from "~/utils/i18n";
import {
	commands,
	type DiagnosticProgress,
	type DiagnosticRunResult,
	events,
	type SystemDiagnostics,
} from "~/utils/tauri";
import IconLucideAlertTriangle from "~icons/lucide/alert-triangle";
import {
	Section,
	SectionRows,
	SettingItem,
	SettingsPageContent,
	ToggleSettingItem,
} from "./Setting";

const sendFeedbackAction = action(async (_feedback: string) => {
	showAccountComingSoon();
	return { success: false };
});

async function fetchDiagnostics(): Promise<SystemDiagnostics | null> {
	try {
		return await commands.getSystemDiagnostics();
	} catch (e) {
		console.error("Failed to fetch diagnostics:", e);
		return null;
	}
}

const DIAGNOSTIC_MODES = [
	{ text: "录制与实时模式", value: "both" },
	{ text: "仅录制模式", value: "studio" },
	{ text: "仅实时模式", value: "instant" },
];

const DIAGNOSTIC_DURATIONS = [
	{ text: "20 秒", value: 20 },
	{ text: "40 秒", value: 40 },
	{ text: "60 秒", value: 60 },
];

/** Stage names come from the CLI verbatim; unknown ones are shown as-is. */
const SYNC_STAGE_LABELS: Record<string, string> = {
	collecting: "正在准备诊断",
	recording: "正在录制测试画面",
	"pattern-run": "正在播放闪烁与提示音",
	remuxing: "正在整理录制文件",
	analyzing: "正在分析画面与声音的时间差",
	exporting: "正在导出诊断录制",
	done: "正在完成音画同步诊断",
};

const VERDICT_LABELS = new Map([
	["pass", "Diagnostic passed"],
	["warn", "Diagnostic needs attention"],
	["fail", "Diagnostic failed"],
	["inconclusive", "Diagnostic inconclusive"],
]);

const VERDICT_STYLES: Record<string, string> = {
	pass: "bg-green-500/20 text-green-400",
	warn: "bg-amber-500/20 text-amber-400",
	fail: "bg-red-500/20 text-red-400",
	inconclusive: "bg-gray-4 text-gray-11",
};

function progressLabel(payload: DiagnosticProgress) {
	if (payload.phase === "collecting") return localize("正在收集系统信息…");
	if (payload.phase === "done") return localize("正在收尾…");
	const stage = payload.stage
		? (SYNC_STAGE_LABELS[payload.stage] ?? payload.stage)
		: localize("正在运行音画同步诊断");
	const mode =
		payload.mode === "studio"
			? localize("录制模式")
			: payload.mode === "instant"
				? localize("实时模式")
				: undefined;
	return `${localize(stage)}${mode ? `（${mode}）` : ""}…`;
}

function SelectDiagnosticItem<T extends string | number>(props: {
	label: string;
	description: string;
	value: T;
	options: { text: string; value: T }[];
	onChange: (value: T) => void;
}) {
	return (
		<SettingItem label={props.label} description={props.description}>
			<LocalizedChoiceSelect
				aria-label={props.label}
				value={props.value}
				options={props.options.map((option) => ({
					value: option.value,
					label: option.text,
				}))}
				onChange={props.onChange}
			/>
		</SettingItem>
	);
}

export default function FeedbackTab() {
	const [feedback, setFeedback] = createSignal("");
	const [diagnostics] = createResource(fetchDiagnostics);

	const [mode, setMode] = createSignal("both");
	const [durationSecs, setDurationSecs] = createSignal(20);
	const [includeMicrophone, setIncludeMicrophone] = createSignal(false);
	const [running, setRunning] = createSignal(false);
	const [status, setStatus] = createSignal<string | null>(null);
	const [result, setResult] = createSignal<DiagnosticRunResult | null>(null);

	const submission = useSubmission(sendFeedbackAction);
	const sendFeedback = useAction(sendFeedbackAction);

	const handleRunDiagnostic = async () => {
		const confirmed = await confirm(
			localize(
				"诊断将显示闪烁测试图案并播放提示音，每种录制流程约 {seconds} 秒。请摘下耳机、保持音量可听见，并在完成前暂停操作。",
				{ seconds: durationSecs() },
			),
			{
				title: localize("开始运行诊断？"),
				kind: "warning",
				okLabel: localize("开始诊断"),
			},
		);
		if (!confirmed) return;

		setRunning(true);
		setResult(null);
		setStatus("Starting...");

		const unlisten = await events.diagnosticProgress.listen((event) =>
			setStatus(progressLabel(event.payload)),
		);

		try {
			setResult(
				await commands.runDiagnostic({
					includeSyncTest: true,
					mode: mode(),
					durationSecs: durationSecs(),
					includeMicrophone: includeMicrophone(),
					micName: null,
					skipExport: false,
				}),
			);
		} catch (error) {
			toast.error(localize("Failed to run diagnostic"));
			console.error("Failed to run diagnostic:", error);
		} finally {
			unlisten();
			setRunning(false);
			setStatus(null);
		}
	};

	const handleSendReport = () => showAccountComingSoon();

	const handleRevealReport = async () => {
		const report = result();
		if (!report) return;

		try {
			await commands.revealDiagnosticReport(report.reportPath);
		} catch (error) {
			toast.error(localize("Failed to show diagnostic report"));
			console.error("Failed to reveal diagnostic report:", error);
		}
	};

	const handleUploadLogs = () => showAccountComingSoon();

	return (
		<div class="cap-settings-page flex flex-col w-full h-full custom-scroll">
			<SettingsPageContent>
				<Section
					title={localize("Feedback")}
					description={localize("在线反馈敬请期待，本机诊断仍可正常使用。")}
				>
					<form
						class="space-y-4"
						onSubmit={(e) => {
							e.preventDefault();
							sendFeedback(feedback());
						}}
					>
						<fieldset disabled={submission.pending}>
							<div>
								<textarea
									value={feedback()}
									onInput={(e) => setFeedback(e.currentTarget.value)}
									placeholder={localize("分享建议或反馈问题…")}
									required
									minLength={10}
									class="p-2 w-full h-32 text-[13px] rounded-md border transition-colors duration-200 resize-none bg-gray-2 placeholder:text-gray-10 border-gray-3 text-primary focus:outline-hidden focus:ring-1 focus:ring-gray-8 hover:border-gray-6"
								/>
							</div>

							{submission.error && (
								<p class="mt-2 text-sm text-red-400">
									{submission.error.toString()}
								</p>
							)}

							{submission.result?.success && (
								<p class="text-sm text-primary">
									{localize("Thank you for your feedback!")}
								</p>
							)}

							<Button
								type="submit"
								size="md"
								variant="dark"
								disabled={feedback().trim().length < 4}
								class="mt-2"
							>
								{submission.pending
									? localize("正在提交…")
									: localize("提交反馈")}
							</Button>
						</fieldset>
					</form>
				</Section>

				<Section
					title={localize("Join the Community")}
					description={localize("在线社区功能敬请期待。")}
				>
					<Button onClick={showAccountComingSoon} size="md" variant="gray">
						{localize("Join Discord")}
					</Button>
				</Section>

				<Section
					title={localize("Diagnostic Report")}
					description={localize(
						"运行音画同步诊断，并收集硬件、显示器、摄像头、麦克风、应用设置、近期录制信息和日志，帮助我们复现问题。发送前可先查看完整报告。",
					)}
				>
					<div class="space-y-2.5">
						<div class="flex gap-2.5 items-start px-3 py-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10">
							<IconLucideAlertTriangle class="mt-0.5 size-3.5 shrink-0 text-amber-400" />
							<p class="text-xs leading-relaxed text-gray-11">
								{localize(
									"The sync test takes over your screen with a flashing pattern and plays loud beeps for about",
								)}
								{durationSecs()}{" "}
								{localize(
									"seconds per pipeline. Take your headphones off and leave the volume audible (the microphone test needs to hear the beeps through your speakers), and don't use the machine until it finishes.",
								)}
							</p>
						</div>

						<fieldset disabled={running()}>
							<SectionRows>
								<SelectDiagnosticItem
									label={localize("Pipelines to test")}
									description={localize(
										"Studio recordings, Instant recordings, or both in one run.",
									)}
									value={mode()}
									options={DIAGNOSTIC_MODES}
									onChange={setMode}
								/>
								<SelectDiagnosticItem
									label={localize("Test duration")}
									description={localize(
										"Longer runs are more sensitive to slow drift.",
									)}
									value={durationSecs()}
									options={DIAGNOSTIC_DURATIONS}
									onChange={setDurationSecs}
								/>
								<ToggleSettingItem
									label={localize("Test microphone too")}
									description={localize(
										"Also records your microphone and checks it against the beeps it can hear.",
									)}
									value={includeMicrophone()}
									onChange={setIncludeMicrophone}
								/>
							</SectionRows>
						</fieldset>

						<div class="flex gap-3 items-center">
							<Button
								onClick={handleRunDiagnostic}
								size="md"
								variant="dark"
								disabled={running()}
							>
								{running() ? localize("正在运行…") : localize("开始诊断")}
							</Button>
							<Show when={running() && status()}>
								{(label) => <p class="text-xs text-gray-10">{label()}</p>}
							</Show>
						</div>

						<Show when={result()}>
							{(report) => (
								<div class="px-4 py-3.5 space-y-2.5 rounded-xl border border-gray-3 bg-gray-2">
									<div class="flex gap-2 items-center flex-wrap">
										<span
											class={`px-2 py-1 rounded text-xs ${
												VERDICT_STYLES[report().verdict ?? ""] ??
												"bg-gray-4 text-gray-11"
											}`}
										>
											<MotionText
												text={localize(
													VERDICT_LABELS.get(report().verdict ?? "") ??
														report().verdict ??
														"System information only",
												)}
											/>
										</span>
										<Show when={report().summary}>
											{(summary) => (
												<p class="text-xs text-gray-11">{summary()}</p>
											)}
										</Show>
									</div>

									<Show when={report().syncTestError}>
										{(error) => (
											<p class="text-xs leading-relaxed text-amber-400">
												{localize("The sync test couldn't run:")} {error()}
												{localize(
													". The report still contains your system information.",
												)}
											</p>
										)}
									</Show>

									<div class="flex gap-2 items-center">
										<Button onClick={handleSendReport} size="md" variant="dark">
											{localize("敬请期待")}
										</Button>
										<Button
											onClick={handleRevealReport}
											size="md"
											variant="gray"
										>
											{localize("Show File")}
										</Button>
									</div>
								</div>
							)}
						</Show>
					</div>
				</Section>

				<Section
					title={localize("Debug Information")}
					description={localize(
						"在线日志反馈敬请期待，诊断报告可在本机生成和查看。",
					)}
				>
					<Button onClick={handleUploadLogs} size="md" variant="gray">
						{localize("敬请期待")}
					</Button>
				</Section>

				<Section title={localize("System Information")}>
					<Show
						when={!diagnostics.loading && diagnostics()}
						fallback={
							<p class="text-xs leading-relaxed text-gray-10">
								{localize("Loading system information...")}
							</p>
						}
					>
						{(diag) => {
							const d = diag() as Record<string, unknown>;
							const osVersion =
								"macosVersion" in d
									? (d.macosVersion as { displayName: string } | null)
									: "windowsVersion" in d
										? (d.windowsVersion as { displayName: string } | null)
										: "linuxVersion" in d
											? (d.linuxVersion as { displayName: string } | null)
											: null;
							const captureSupported =
								"screenCaptureSupported" in d
									? (d.screenCaptureSupported as boolean)
									: "graphicsCaptureSupported" in d
										? (d.graphicsCaptureSupported as boolean)
										: false;
							return (
								<div class="space-y-3 text-sm">
									<Show when={osVersion}>
										{(ver) => (
											<div class="space-y-1">
												<p class="text-gray-11 font-medium">
													{localize("Operating System")}
												</p>
												<p class="text-gray-10 bg-gray-2 px-2 py-1.5 rounded-sm font-mono text-xs">
													{ver().displayName}
												</p>
											</div>
										)}
									</Show>

									<div class="space-y-1">
										<p class="text-gray-11 font-medium">
											{localize("Capture Support")}
										</p>
										<div class="flex gap-2 flex-wrap">
											<span
												class={`px-2 py-1 rounded text-xs ${
													captureSupported
														? "bg-green-500/20 text-green-400"
														: "bg-red-500/20 text-red-400"
												}`}
											>
												{localize("Screen Capture:")}{" "}
												{captureSupported ? "Supported" : "Not Supported"}
											</span>
										</div>
									</div>

									<Show when={(d.availableEncoders as string[])?.length > 0}>
										<div class="space-y-1">
											<p class="text-gray-11 font-medium">
												{localize("Available Encoders")}
											</p>
											<div class="flex gap-1.5 flex-wrap">
												<For each={d.availableEncoders as string[]}>
													{(encoder) => (
														<span class="px-2 py-1 bg-gray-2 rounded-sm text-xs text-gray-10 font-mono">
															{encoder}
														</span>
													)}
												</For>
											</div>
										</div>
									</Show>
								</div>
							);
						}}
					</Show>
				</Section>
			</SettingsPageContent>
		</div>
	);
}
