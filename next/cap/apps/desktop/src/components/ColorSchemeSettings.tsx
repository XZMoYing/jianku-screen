import { createMemo, createSignal, For, Show } from "solid-js";
import toast from "solid-toast";
import { ChoiceSelect } from "~/components/ChoiceSelect";
import { colorSchemeStore } from "~/store";
import {
	basicColors,
	type ColorSchemeSettings,
	colorTokens,
	colorVariants,
	normalizeColorSettings,
	selectedSeed,
} from "~/utils/color-scheme";
import { refreshWallpaperColors } from "~/utils/dynamic-theme";
import { t as localize } from "~/utils/i18n";

export default function ColorSchemeOptions() {
	const query = colorSchemeStore.createQuery();
	const settings = createMemo(() => normalizeColorSettings(query.data));
	const [busy, setBusy] = createSignal(false);
	const [error, setError] = createSignal("");
	const save = async (patch: Partial<ColorSchemeSettings>) => {
		setBusy(true);
		try {
			await colorSchemeStore.set(patch);
			setError("");
		} catch (e) {
			setError(String(e));
			toast.error(localize("配色设置未保存，请重试"));
		} finally {
			setBusy(false);
		}
	};
	const refresh = async () => {
		setBusy(true);
		try {
			await refreshWallpaperColors(true);
			setError("");
		} catch {
			setError(
				localize("暂时无法读取当前壁纸。你可以重新取色或选择基本配色。"),
			);
		} finally {
			setBusy(false);
		}
	};
	const swatches = (seed: string) => {
		const tokens = colorTokens(
			seed,
			settings().variant,
			false,
			settings().contrast,
		);
		return `conic-gradient(${tokens["--jk-primary-container"]} 0 90deg, ${tokens["--jk-primary"]} 90deg 180deg, ${tokens["--jk-tertiary-container"]} 180deg 270deg, ${tokens["--jk-secondary-container"]} 270deg)`;
	};
	return (
		<fieldset class="jk-color-settings" disabled={busy()}>
			<div class="jk-color-sources" aria-label={localize("配色来源")}>
				<For
					each={
						[
							{ id: "wallpaper", name: "壁纸配色" },
							{ id: "custom", name: "基本配色" },
						] as const
					}
				>
					{(source) => (
						<button
							type="button"
							aria-pressed={settings().source === source.id}
							onClick={async () => {
								await save({ source: source.id });
								if (
									source.id === "wallpaper" &&
									!settings().wallpaperSeeds.length
								)
									await refresh();
							}}
						>
							{localize(source.name)}
						</button>
					)}
				</For>
			</div>
			<Show
				when={settings().source === "wallpaper"}
				fallback={
					<div
						class="jk-color-grid"
						role="radiogroup"
						aria-label={localize("基本配色")}
					>
						<For each={basicColors}>
							{(color) => (
								<button
									type="button"
									role="radio"
									aria-checked={settings().seed === color.hex}
									onClick={() => void save({ seed: color.hex })}
								>
									<span
										class="jk-color-orb"
										style={{ background: swatches(color.hex) }}
									/>
									<span>{localize(color.name)}</span>
								</button>
							)}
						</For>
					</div>
				}
			>
				<div
					class="jk-color-grid"
					role="radiogroup"
					aria-label={localize("壁纸配色")}
				>
					<For each={settings().wallpaperSeeds}>
						{(seed, index) => (
							<button
								type="button"
								role="radio"
								aria-checked={selectedSeed(settings()) === seed}
								onClick={() => void save({ wallpaperIndex: index() })}
							>
								<span
									class="jk-color-orb"
									style={{ background: swatches(seed) }}
								/>
								<span>
									{localize("配色")} {index() + 1}
								</span>
							</button>
						)}
					</For>
				</div>
				<div class="jk-color-info">
					<span>
						{settings().wallpaperSeeds.length
							? localize("取自当前壁纸")
							: localize("等待壁纸取色，暂用中性色")}
					</span>
					<button
						type="button"
						class="jk-tonal-button"
						onClick={() => void refresh()}
					>
						{busy() ? localize("正在取色…") : localize("重新取色")}
					</button>
				</div>
			</Show>
			<div class="jk-color-variants" aria-label={localize("配色风格")}>
				<For each={colorVariants}>
					{(variant) => (
						<button
							type="button"
							aria-pressed={settings().variant === variant.id}
							onClick={() => void save({ variant: variant.id })}
						>
							{localize(variant.name)}
						</button>
					)}
				</For>
			</div>
			<div class="jk-color-info">
				<label>
					{localize("对比度")}{" "}
					<ChoiceSelect
						value={settings().contrast}
						onChange={(choiceValue) =>
							void save({ contrast: Number(choiceValue) })
						}
						options={[
							{ value: 0, label: localize("标准") },
							{ value: 0.5, label: localize("中") },
							{ value: 1, label: localize("高") },
						]}
					/>
				</label>
				<Show when={settings().source === "custom"}>
					<label>
						{localize("自选种子色")}{" "}
						<input
							type="color"
							value={settings().seed}
							onChange={(event) =>
								void save({ seed: event.currentTarget.value })
							}
						/>
					</label>
				</Show>
				<Show when={settings().source === "wallpaper"}>
					<span class="jk-color-seed">
						{selectedSeed(settings()).toUpperCase()}
					</span>
				</Show>
			</div>
			<Show when={error()}>
				<p class="jk-color-error">{error()}</p>
			</Show>
		</fieldset>
	);
}
