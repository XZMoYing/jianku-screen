import { createMemo, createSignal, For, Show } from "solid-js";
import toast from "solid-toast";
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
			toast.error("配色设置未保存，请重试");
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
			setError("暂时无法读取当前壁纸。你可以重新取色或选择基本配色。");
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
			<div class="jk-color-sources" aria-label="配色来源">
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
							{source.name}
						</button>
					)}
				</For>
			</div>
			<Show
				when={settings().source === "wallpaper"}
				fallback={
					<div class="jk-color-grid" role="radiogroup" aria-label="基本配色">
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
									<span>{color.name}</span>
								</button>
							)}
						</For>
					</div>
				}
			>
				<div class="jk-color-grid" role="radiogroup" aria-label="壁纸配色">
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
								<span>配色 {index() + 1}</span>
							</button>
						)}
					</For>
				</div>
				<div class="jk-color-info">
					<span>
						{settings().wallpaperSeeds.length
							? "取自当前壁纸"
							: "等待壁纸取色，暂用中性色"}
					</span>
					<button
						type="button"
						class="jk-tonal-button"
						onClick={() => void refresh()}
					>
						{busy() ? "正在取色…" : "重新取色"}
					</button>
				</div>
			</Show>
			<div class="jk-color-variants" aria-label="配色风格">
				<For each={colorVariants}>
					{(variant) => (
						<button
							type="button"
							aria-pressed={settings().variant === variant.id}
							onClick={() => void save({ variant: variant.id })}
						>
							{variant.name}
						</button>
					)}
				</For>
			</div>
			<div class="jk-color-info">
				<label>
					对比度{" "}
					<select
						value={settings().contrast}
						onChange={(event) =>
							void save({ contrast: Number(event.currentTarget.value) })
						}
					>
						<option value={0}>标准</option>
						<option value={0.5}>中</option>
						<option value={1}>高</option>
					</select>
				</label>
				<Show when={settings().source === "custom"}>
					<label>
						自选种子色{" "}
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
