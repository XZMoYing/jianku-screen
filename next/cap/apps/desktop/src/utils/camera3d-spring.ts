import response from "./camera3d-spring-reference.json";
import type { Camera3DMotionSpring } from "./tauri";

function residual(time: number) {
	const last = response.samples.length - 1;
	const at = Math.min(last, Math.max(0, time / response.stepSeconds));
	const index = Math.min(last - 1, Math.floor(at));
	const t = at - index;
	const [a, va] = response.samples[index];
	const [b, vb] = response.samples[index + 1];
	const t2 = t * t;
	const t3 = t2 * t;
	return (
		(2 * t3 - 3 * t2 + 1) * a +
		(t3 - 2 * t2 + t) * response.stepSeconds * va +
		(-2 * t3 + 3 * t2) * b +
		(t3 - t2) * response.stepSeconds * vb
	);
}

function rampPosition(progress: number) {
	if (progress <= 0) return 0;
	if (progress >= 1) return 1;
	const settle = (response.samples.length - 1) * response.stepSeconds;
	const duration = response.moveSeconds;
	const time = progress * (duration + settle);
	return time <= duration
		? (time - response.samples[0][0] + residual(time)) / duration
		: 1 + (residual(time) - residual(time - duration)) / duration;
}

export function camera3DSpringProgress(
	motion: Camera3DMotionSpring,
	progress: number,
) {
	const [start, end] = motion.range ?? [0, 1];
	const range = end - start;
	if (
		!Number.isFinite(start) ||
		!Number.isFinite(end) ||
		start < 0 ||
		start > 1 ||
		end < 0 ||
		end > 1 ||
		Math.abs(range) < 1e-9
	)
		return progress;
	const from = rampPosition(start);
	const to = rampPosition(end);
	if (Math.abs(to - from) <= Number.EPSILON) return progress;
	return (rampPosition(start + range * progress) - from) / (to - from);
}
