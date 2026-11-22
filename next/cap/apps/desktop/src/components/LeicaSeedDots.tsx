import { createMemo, For } from "solid-js";
import { colorSchemeStore, generalSettingsStore } from "~/store";
import { leicaPresets, normalizeColorSettings } from "~/utils/color-scheme";
import { t as localize } from "~/utils/i18n";
import IconLucideMoon from "~icons/lucide/moon";
import IconLucideSun from "~icons/lucide/sun";

export function LeicaSeedDots() {
	const query = colorSchemeStore.createQuery();
	const settings = createMemo(() => normalizeColorSettings(query.data));

	return (
		<div
			class="jk-seed-dots"
			role="radiogroup"
			aria-label={localize("精调配色")}
		>
			<For each={leicaPresets}>
				{(preset) => {
					const active = () =>
						settings().source === "preset" && settings().preset === preset.id;
					return (
						<button
							type="button"
							role="radio"
							aria-checked={active()}
							aria-label={localize(preset.name)}
							title={localize(preset.name)}
							class="jk-seed-dot"
							classList={{ "is-active": active() }}
							style={{ background: preset.swatch }}
							onClick={() =>
								void colorSchemeStore.set({
									source: "preset",
									preset: preset.id,
									seed: preset.accentHex,
								})
							}
						/>
					);
				}}
			</For>
		</div>
	);
}

export function LeicaThemeToggle() {
	const query = generalSettingsStore.createQuery();
	const isDark = () => {
		const theme = query.data?.theme ?? "system";
		if (theme === "dark") return true;
		if (theme === "light") return false;
		return document.documentElement.classList.contains("dark");
	};
	return (
		<button
			type="button"
			class="jk-button flex h-7 w-7 items-center justify-center rounded-lg text-[var(--jk-muted)] hover:text-[var(--jk-ink)]"
			aria-label={isDark() ? localize("浅色外观") : localize("深色外观")}
			title={isDark() ? localize("浅色外观") : localize("深色外观")}
			onClick={() =>
				void generalSettingsStore.set({
					theme: isDark() ? "light" : "dark",
				})
			}
		>
			{isDark() ? (
				<IconLucideSun class="size-4" />
			) : (
				<IconLucideMoon class="size-4" />
			)}
		</button>
	);
}
