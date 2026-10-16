import { DropdownMenu as KDropdownMenu } from "@kobalte/core/dropdown-menu";
import { cx } from "cva";
import { For, Show, Suspense } from "solid-js";
import { reconcile } from "solid-js/store";
import toast from "solid-toast";
import { t as localize } from "~/utils/i18n";
import { commands } from "~/utils/tauri";
import { normalizeProject, useEditorContext } from "./context";
import {
	DropdownItem,
	dropdownContainerClasses,
	EditorButton,
	MenuItem,
	MenuItemList,
	PopperContent,
	topCenterAnimateClasses,
} from "./ui";

export function PresetsDropdown() {
	const { setDialog, presets, setProject, project } = useEditorContext();

	async function applyDefaultPreset() {
		const stock = await commands.getDefaultProjectConfig();
		setProject(
			reconcile(
				normalizeProject({
					...stock,
					timeline: project.timeline ?? null,
					overlayOrder: project.overlayOrder ?? [],
					clips: project.clips,
				}),
			),
		);
	}

	return (
		<KDropdownMenu gutter={8} placement="bottom">
			<EditorButton<typeof KDropdownMenu.Trigger>
				as={KDropdownMenu.Trigger}
				leftIcon={<IconCapPresets />}
				rightIcon={<IconCapChevronDown />}
				title={localize("Presets")}
				aria-label={localize("Presets")}
			>
				<span class="max-[1200px]:hidden">{localize("Presets")}</span>
			</EditorButton>
			<KDropdownMenu.Portal>
				<Suspense>
					<PopperContent<typeof KDropdownMenu.Content>
						as={KDropdownMenu.Content}
						class={cx("w-72 max-h-56", topCenterAnimateClasses)}
					>
						<MenuItemList<typeof KDropdownMenu.Group>
							as={KDropdownMenu.Group}
							class="overflow-y-auto flex-1 scrollbar-none"
						>
							<KDropdownMenu.Sub gutter={16}>
								<MenuItem<typeof KDropdownMenu.SubTrigger>
									as={KDropdownMenu.SubTrigger}
									class="h-10"
									onClick={() => {
										applyDefaultPreset();
									}}
								>
									<span class="mr-auto">{localize("Default")}</span>
									<Show when={(presets.query.data?.default ?? null) === null}>
										<span class="px-2 py-1 text-[11px] rounded-full bg-ed-ctl text-ed-text-2">
											{localize("Default")}
										</span>
									</Show>
									<IconCapSettings class="text-ed-text-3 group-hover:text-[currentColor] shrink-0" />
								</MenuItem>
								<KDropdownMenu.Portal>
									<MenuItemList<typeof KDropdownMenu.SubContent>
										as={KDropdownMenu.SubContent}
										class={cx(
											"w-52 animate-in fade-in slide-in-from-left-1",
											dropdownContainerClasses,
										)}
									>
										<DropdownItem
											onSelect={() => {
												applyDefaultPreset();
											}}
										>
											{localize("Apply")}
										</DropdownItem>
										<DropdownItem onSelect={() => presets.setDefault(null)}>
											{localize("Set as default")}
										</DropdownItem>
									</MenuItemList>
								</KDropdownMenu.Portal>
							</KDropdownMenu.Sub>
							<For
								each={presets.query.data?.presets ?? []}
								fallback={
									<div class="py-1 w-full text-sm text-center text-ed-text-3">
										{localize("No saved presets")}
									</div>
								}
							>
								{(preset, i) => {
									function applyPreset() {
										const normalizedConfig = normalizeProject({
											...preset.config,
											timeline: project.timeline ?? null,
											overlayOrder: project.overlayOrder ?? [],
											clips: project.clips,
										});
										setProject(reconcile(normalizedConfig));
									}

									return (
										<KDropdownMenu.Sub gutter={16}>
											<MenuItem<typeof KDropdownMenu.SubTrigger>
												as={KDropdownMenu.SubTrigger}
												class="h-10"
												onClick={() => {
													applyPreset();
												}}
											>
												<span class="mr-auto">{preset.name}</span>
												<Show when={presets.query.data?.default === i()}>
													<span class="px-2 py-1 text-[11px] rounded-full bg-ed-ctl text-ed-text-2">
														{localize("Default")}
													</span>
												</Show>
												<IconCapSettings class="text-ed-text-3 group-hover:text-[currentColor] shrink-0" />
											</MenuItem>
											<KDropdownMenu.Portal>
												<MenuItemList<typeof KDropdownMenu.SubContent>
													as={KDropdownMenu.SubContent}
													class={cx(
														"w-52 animate-in fade-in slide-in-from-left-1",
														dropdownContainerClasses,
													)}
												>
													<DropdownItem
														onSelect={() => {
															applyPreset();
														}}
													>
														{localize("Apply")}
													</DropdownItem>
													<DropdownItem
														onSelect={async () => {
															await presets.saveToPreset(i(), project);
															toast.success(
																`Saved settings to "${preset.name}"`,
															);
														}}
													>
														{localize("Save settings to preset")}
													</DropdownItem>
													<DropdownItem
														onSelect={() => presets.setDefault(i())}
													>
														{localize("Set as default")}
													</DropdownItem>
													<DropdownItem
														onSelect={() =>
															setDialog({
																type: "renamePreset",
																presetIndex: i(),
																open: true,
															})
														}
													>
														{localize("Rename")}
													</DropdownItem>
													<DropdownItem
														onClick={() =>
															setDialog({
																type: "deletePreset",
																presetIndex: i(),
																open: true,
															})
														}
													>
														{localize("Delete")}
													</DropdownItem>
												</MenuItemList>
											</KDropdownMenu.Portal>
										</KDropdownMenu.Sub>
									);
								}}
							</For>
						</MenuItemList>
						<MenuItemList<typeof KDropdownMenu.Group>
							as={KDropdownMenu.Group}
							class="border-t border-ed-line shrink-0"
						>
							<DropdownItem
								onSelect={() => setDialog({ type: "createPreset", open: true })}
							>
								<span>{localize("Create new preset")}</span>
								<IconCapCirclePlus class="ml-auto" />
							</DropdownItem>
						</MenuItemList>
					</PopperContent>
				</Suspense>
			</KDropdownMenu.Portal>
		</KDropdownMenu>
	);
}

export default PresetsDropdown;
