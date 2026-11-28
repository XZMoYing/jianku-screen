import { createEffect, createSignal, For, on, Show } from "solid-js";
import { t as localize } from "~/utils/i18n";
import {
	CLIP_TRANSITION_OPTIONS,
	getClipTransition,
	MIN_CLIP_TRANSITION_DURATION,
	maxTransitionDuration,
} from "./clip-transitions";
import { useEditorContext } from "./context";
import { EditorButton, Field, Slider } from "./ui";

export function TransitionInspector(props: { index: number }) {
	const { project, projectActions } = useEditorContext();
	const transition = () => {
		const timeline = project.timeline;
		return (
			timeline &&
			getClipTransition(
				timeline.segments,
				timeline.transitions,
				props.index,
				timeline.mainTrackGaps,
			)
		);
	};
	const max = () =>
		maxTransitionDuration(
			project.timeline?.segments[props.index - 1],
			project.timeline?.segments[props.index],
		);
	const [draft, setDraft] = createSignal<number>();
	createEffect(
		on(
			() => props.index,
			() => setDraft(undefined),
		),
	);
	return (
		<Show when={transition()}>
			{(current) => (
				<div class="flex flex-col gap-3.5">
					<h2 class="text-sm font-medium text-ed-text-1">
						{localize("Clip transition")}
					</h2>
					<div class="jk-ed-card flex flex-col gap-3 p-3.5">
						<div
							role="group"
							aria-label={localize("转场类型")}
							class="grid grid-cols-2 gap-1.5"
						>
							<For each={CLIP_TRANSITION_OPTIONS}>
								{([type, label]) => (
									<button
										type="button"
										aria-pressed={current().type === type}
										class="jk-ed-tile h-8 px-2 text-xs"
										onClick={() => {
											const { duration, type: previous } = current();
											if (type !== previous)
												projectActions.setClipTransition(props.index, {
													type,
													duration,
												});
										}}
									>
										{localize(label)}
									</button>
								)}
							</For>
						</div>
						<Field
							inline
							name={localize("Transition duration")}
							value={`${(draft() ?? current().duration).toFixed(2)}s`}
						>
							<Slider
								aria-label={localize("Transition duration")}
								minValue={MIN_CLIP_TRANSITION_DURATION}
								maxValue={max()}
								step={0.05}
								value={[draft() ?? current().duration]}
								onChange={([value]) => setDraft(value)}
								onChangeEnd={([duration]) => {
									if (duration !== current().duration)
										projectActions.setClipTransition(props.index, {
											type: current().type,
											duration,
										});
									setDraft(undefined);
								}}
								formatTooltip="s"
							/>
						</Field>
					</div>
					<EditorButton
						variant="danger"
						onClick={() => projectActions.deleteClipTransition(props.index)}
					>
						{localize("Remove transition")}
					</EditorButton>
				</div>
			)}
		</Show>
	);
}
