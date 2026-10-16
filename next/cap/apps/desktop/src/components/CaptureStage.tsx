import { createMemo, For, Show } from "solid-js";
import { ASPECT_RATIOS } from "~/routes/editor/projectConfig";
import type { CaptureStyle } from "~/utils/tauri";
import { appearanceBackground } from "./CaptureAppearance";

export default function CaptureStage(props: {
	style: CaptureStyle | undefined;
}) {
	const ratio = createMemo(() => {
		const aspect = props.style?.config.aspectRatio;
		return aspect ? ASPECT_RATIOS[aspect].ratio : [16, 10];
	});
	const background = () => props.style?.config.background;
	const fill = () => {
		const source = background()?.source;
		return source ? appearanceBackground(source) : "var(--jk-container)";
	};
	return (
		<section class="jk-capture-stage" aria-label="捕获画面布局示意">
			<div class="jk-stage-canvas">
				<div
					class="jk-stage-output"
					style={{
						"aspect-ratio": `${ratio()[0]} / ${ratio()[1]}`,
						"--jk-output-ratio": String(ratio()[0] / ratio()[1]),
					}}
				>
					<div
						class="jk-preview-background"
						style={{
							background: fill(),
							"background-size": "cover",
							"background-position": "center",
							filter: `blur(${(background()?.blur ?? 0) / 4}px)`,
						}}
					/>
					<div
						class="jk-stage-frame"
						style={{
							width: `${Math.min(100 - (background()?.padding ?? 10) * 2, ((100 - (background()?.padding ?? 10) * 2) * 1.6) / (ratio()[0] / ratio()[1]))}%`,
							"border-radius": `${background()?.rounding ?? 8}px`,
							padding: `${(background()?.inset ?? 0) / 8}px`,
							"box-shadow": `0 ${(background()?.shadow ?? 0) / 4}px ${background()?.advancedShadow?.blur ?? background()?.shadow ?? 0}px rgb(0 0 0 / ${((background()?.shadow ?? 0) / 100) * 0.26})`,
						}}
					>
						<div class="jk-stage-window" aria-hidden="true">
							<div class="jk-stage-chrome">
								<i />
								<i />
								<i />
								<span />
							</div>
							<div class="jk-stage-document">
								<div class="jk-stage-rail">
									<b />
									<i />
									<i />
									<i />
									<i />
								</div>
								<div class="jk-stage-sheet">
									<div class="jk-stage-heading">
										<i />
										<b />
									</div>
									<div class="jk-stage-chart">
										<For each={[25, 43, 35, 62, 50, 76, 68, 88]}>
											{(height) => <i style={{ height: `${height}%` }} />}
										</For>
									</div>
									<div class="jk-stage-tiles">
										<span />
										<span />
										<span />
									</div>
								</div>
							</div>
							<Show when={!props.style?.config.cursor.hide}>
								<svg
									class="jk-stage-cursor"
									viewBox="0 0 24 30"
									role="img"
									aria-label="示意光标"
								>
									<path
										d="M3 2v23l6-6 5 10 4-2-5-10h9Z"
										fill="var(--jk-ink)"
										stroke="var(--jk-paper)"
										stroke-width="2"
										stroke-linejoin="round"
									/>
								</svg>
							</Show>
						</div>
					</div>
				</div>
			</div>
			<footer class="jk-stage-footer">
				<span>
					<i />
					画面示意
				</span>
				<span>
					{props.style?.config.aspectRatio ? ratio().join(":") : "适合屏幕"}
				</span>
			</footer>
		</section>
	);
}
