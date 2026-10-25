import { Show } from "solid-js";
import { RgbInput } from "~/routes/editor/color-utils";
import { Field, Slider } from "~/routes/editor/ui";
import { t as localize } from "~/utils/i18n";
import type { BackgroundConfiguration } from "~/utils/tauri";

export function InsetSettings(props: {
	background: BackgroundConfiguration;
	onChange: (patch: Partial<BackgroundConfiguration>) => void;
	history?: { pause: () => () => void };
}) {
	const style = () =>
		props.background.insetStyle ?? {
			color: [0, 0, 0] as [number, number, number],
			opacity: 50,
		};
	return (
		<div class="jk-layout-settings">
			<Field
				inline
				name={localize("内边距")}
				value={localize("{value} 像素", {
					value: Math.min(100, props.background.inset),
				})}
			>
				<Slider
					history={props.history}
					value={[Math.min(100, props.background.inset)]}
					minValue={0}
					maxValue={100}
					step={1}
					onChange={([inset]) => props.onChange({ inset })}
				/>
			</Field>
			<Show when={props.background.inset > 0}>
				<p class="text-xs text-ed-text-2">
					{localize("以画面短边 1080 像素为基准，随画面尺寸等比缩放。")}
				</p>
				<Field name={localize("内框颜色")}>
					<RgbInput
						value={style().color}
						onChange={(color) => {
							const resume = props.history?.pause();
							props.onChange({ insetStyle: { ...style(), color } });
							if (resume) queueMicrotask(resume);
						}}
					/>
				</Field>
				<Field
					inline
					name={localize("内框不透明度")}
					value={`${Math.round(style().opacity)}%`}
				>
					<Slider
						history={props.history}
						value={[style().opacity]}
						minValue={0}
						maxValue={100}
						step={1}
						onChange={([opacity]) =>
							props.onChange({ insetStyle: { ...style(), opacity } })
						}
					/>
				</Field>
			</Show>
		</div>
	);
}
