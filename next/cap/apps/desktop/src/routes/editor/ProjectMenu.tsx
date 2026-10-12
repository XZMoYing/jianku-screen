import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import { createEventListener } from "@solid-primitives/event-listener";
import { save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { createResource, createSignal, For, Show } from "solid-js";
import toast from "solid-toast";
import { projectCopyName } from "~/utils/project-files";
import { commands } from "~/utils/tauri";
import { isModalDialog, useEditorContext } from "./context";
import { savePortableCopy } from "./project-copy";
import { EditorButton, MenuItem, MenuItemList, PopperContent } from "./ui";

export function ProjectMenu(props: {
	flush: () => Promise<void>;
	onBusyChange: (busy: boolean) => void;
	disabled?: boolean;
}) {
	const {
		editorInstance,
		meta,
		dialog,
		editorState,
		setEditorState,
		exportState,
	} = useEditorContext();
	const [busy, setBusy] = createSignal(false);
	const [recent, { refetch }] = createResource(() =>
		commands.listLocalProjects().catch((error: unknown) => {
			console.warn("Could not read local project history", error);
			return [];
		}),
	);
	const unavailable = () =>
		props.disabled ||
		busy() ||
		isModalDialog(dialog()) ||
		(exportState.type !== "idle" && exportState.type !== "done");
	const action = async (run: () => Promise<unknown>) => {
		if (unavailable()) return;
		setBusy(true);
		props.onBusyChange(true);
		try {
			if (editorState.playing) {
				await commands.stopPlayback();
				setEditorState("playing", false);
			}
			await run();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
			props.onBusyChange(false);
		}
	};
	const open = (path: string) =>
		action(async () => {
			await props.flush();
			await commands.openLocalProject(path);
		});
	const pick = () =>
		action(async () => {
			const path = await commands.pickLocalProject();
			if (!path) return;
			await props.flush();
			await commands.openLocalProject(path);
		});
	const saveCurrent = () =>
		action(async () => {
			await props.flush();
			toast.success("工程已保存");
		});
	const copy = () =>
		action(() =>
			savePortableCopy({
				flush: props.flush,
				pickDestination: () =>
					save({
						title: "保存可携带工程副本（请选择新名称）",
						defaultPath: projectCopyName(meta().prettyName),
						filters: [{ name: "录制工程", extensions: ["cap"] }],
					}),
				copy: (destination) => commands.copyEditorProject(destination),
				open: (path) => commands.openLocalProject(path),
				onSaved: (path) => toast.success(`工程副本已保存：${path}`),
			}),
		);
	createEventListener(window, "keydown", (event) => {
		if (!(event.metaKey || event.ctrlKey) || event.altKey || unavailable())
			return;
		if (event.key.toLowerCase() === "s") {
			event.preventDefault();
			void (event.shiftKey ? copy() : saveCurrent());
		} else if (event.key.toLowerCase() === "o") {
			event.preventDefault();
			void pick();
		}
	});
	return (
		<DropdownMenu
			onOpenChange={(open) => {
				if (open) void refetch();
			}}
		>
			<EditorButton<typeof DropdownMenu.Trigger>
				as={DropdownMenu.Trigger}
				disabled={unavailable()}
				leftIcon={<IconLucideFolder />}
				rightIcon={<IconCapChevronDown />}
				aria-label="工程菜单"
			>
				工程
			</EditorButton>
			<DropdownMenu.Portal>
				<PopperContent<typeof DropdownMenu.Content>
					as={DropdownMenu.Content}
					class="w-72 max-h-[420px]"
				>
					<MenuItemList class="overflow-auto">
						<MenuItem<typeof DropdownMenu.Item>
							as={DropdownMenu.Item}
							onSelect={() => void pick()}
						>
							打开工程…{" "}
							<span class="ml-auto text-xs text-ed-text-3">⌘/Ctrl O</span>
						</MenuItem>
						<MenuItem<typeof DropdownMenu.Item>
							as={DropdownMenu.Item}
							onSelect={() => void saveCurrent()}
						>
							保存当前工程{" "}
							<span class="ml-auto text-xs text-ed-text-3">⌘/Ctrl S</span>
						</MenuItem>
						<MenuItem<typeof DropdownMenu.Item>
							as={DropdownMenu.Item}
							onSelect={() => void copy()}
						>
							保存可携带副本…
						</MenuItem>
						<MenuItem<typeof DropdownMenu.Item>
							as={DropdownMenu.Item}
							onSelect={() =>
								void action(() => revealItemInDir(editorInstance.path))
							}
						>
							在文件管理器中显示
						</MenuItem>
						<div class="px-3 pt-3 pb-1 text-xs text-ed-text-3">
							最近打开的工程
						</div>
						<Show
							when={(recent()?.length ?? 0) > 0}
							fallback={
								<p class="px-3 py-2 text-xs text-ed-text-3">
									还没有打开过外部工程
								</p>
							}
						>
							<For each={recent()}>
								{(project) => (
									<MenuItem<typeof DropdownMenu.Item>
										as={DropdownMenu.Item}
										onSelect={() => void open(project.path)}
										title={project.path}
									>
										<span class="truncate">{project.name}</span>
									</MenuItem>
								)}
							</For>
						</Show>
					</MenuItemList>
				</PopperContent>
			</DropdownMenu.Portal>
		</DropdownMenu>
	);
}
