import { emitTo } from "@tauri-apps/api/event";
import { Effect, getCurrentWindow } from "@tauri-apps/api/window";
import { type as ostype } from "@tauri-apps/plugin-os";
import { cx } from "cva";
import {
	createEffect,
	createSignal,
	ErrorBoundary,
	onCleanup,
	onMount,
	Suspense,
} from "solid-js";
import { generalSettingsStore } from "~/store";
import { commands } from "~/utils/tauri";
import { Editor } from "./Editor";
import { EditorErrorScreen } from "./EditorErrorScreen";
import { EditorSkeleton } from "./editor-skeleton";
import { createEditorTitleSaveBridge } from "./editor-title-save-bridge";
import { PreparingEditorProvider } from "./preparing-editor-context";

export default function () {
	const generalSettings = generalSettingsStore.createQuery();
	const currentWindow = getCurrentWindow();
	const [projectPath, setProjectPath] = createSignal("");
	// Keep save acknowledgements alive while editor content is suspended or fails.
	const titleSave = createEditorTitleSaveBridge({
		listen: (event, handler) =>
			currentWindow.listen<{ requestId: string }>(event, ({ payload }) =>
				handler(payload),
			),
		acknowledge: (response) =>
			emitTo(currentWindow.label, "editor-title-save-finished", {
				...response,
				windowLabel: currentWindow.label,
			}),
		onError: (error) =>
			console.error("Editor save acknowledgement failed:", error),
	});
	onCleanup(titleSave.dispose);

	// Rust always leaves the window hidden so this reveal runs after the editor
	// skeleton has painted; showing it earlier exposes the webview's opaque
	// white surface as a cold-open flash. Rust keeps a safety timer to reveal
	// the window if this path fails. Note: requestAnimationFrame must NOT be
	// used to schedule the reveal — hidden webviews throttle/suspend rAF, which
	// silently pushed every editor open onto the slow fallback timeout.
	let revealed = false;
	const reveal = () => {
		if (revealed) return;
		revealed = true;
		const w = getCurrentWindow();
		void w.show().catch(() => {});
		void w.setFocus().catch(() => {});
	};

	createEffect(() => {
		const transparent = generalSettings.data?.windowTransparency ?? false;
		const applied = Promise.allSettled([
			commands.setWindowTransparent(transparent),
			getCurrentWindow().setEffects({
				effects: transparent ? [Effect.HudWindow] : [],
			}),
		]);
		if (generalSettings.data) void applied.then(reveal);
	});

	// Hard fallback: never leave the window hidden if settings fail to load.
	onMount(() => {
		setTimeout(reveal, 250);
	});

	return (
		<div
			class={cx(
				"flex flex-col w-screen h-screen bg-ed-window text-ed-text-1",
				!(
					ostype() === "windows" || !generalSettings.data?.windowTransparency
				) && "bg-transparent-window",
			)}
		>
			<ErrorBoundary
				fallback={(error) => (
					<EditorErrorScreen
						error={error instanceof Error ? error.message : String(error)}
						projectPath={projectPath()}
					/>
				)}
			>
				<PreparingEditorProvider>
					<Suspense fallback={<EditorSkeleton boundary="route-suspense" />}>
						<Editor titleSave={titleSave} onProjectPath={setProjectPath} />
					</Suspense>
				</PreparingEditorProvider>
			</ErrorBoundary>
		</div>
	);
}
