import { createMemo, For } from "solid-js";
import { colorSchemeStore } from "~/store";
import { leicaPresets, normalizeColorSettings } from "~/utils/color-scheme";
import { t as localize } from "~/utils/i18n";

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
