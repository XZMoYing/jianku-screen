import type {
	ZoomSliceTrim,
	ZoomSourceSlice,
	ZoomTrackSpan,
} from "~/utils/tauri";

export function zoomSliceCut(
	slices: readonly ZoomSourceSlice[],
	span: ZoomTrackSpan,
	time: number,
) {
	const slice = slices[span.sliceIndex];
	const attachment = slice?.attachment;
	const sourceEnd = slice?.sourceEnd;
	if (
		!slice ||
		attachment?.kind !== "clip" ||
		sourceEnd == null ||
		sourceEnd <= attachment.sourceTime ||
		time <= span.start ||
		time >= span.end ||
		span.phaseEnd <= span.phaseStart
	)
		return null;
	const phase =
		span.phaseStart +
		((time - span.start) / (span.end - span.start)) *
			(span.phaseEnd - span.phaseStart);
	if (
		!Number.isFinite(phase) ||
		phase <= slice.phaseStart ||
		phase >= slice.phaseEnd
	)
		return null;
	const sourceTime =
		attachment.sourceTime +
		((phase - slice.phaseStart) / (slice.phaseEnd - slice.phaseStart)) *
			(sourceEnd - attachment.sourceTime);
	if (!(sourceTime > attachment.sourceTime && sourceTime < sourceEnd))
		return null;
	return { index: span.sliceIndex, slice, attachment, phase, sourceTime };
}

export function splitZoomSourceSlice(
	slices: readonly ZoomSourceSlice[],
	cut: NonNullable<ReturnType<typeof zoomSliceCut>>,
): ZoomSourceSlice[] {
	const { index, slice, attachment, phase, sourceTime } = cut;
	return [
		...slices.slice(0, index),
		{ ...slice, phaseEnd: phase, sourceEnd: sourceTime },
		{
			...slice,
			phaseStart: phase,
			attachment: {
				...attachment,
				id: `overlay-${crypto.randomUUID()}`,
				sourceTime,
			},
		},
		...slices.slice(index + 1),
	];
}

export function trimZoomSourceSlice(
	slice: ZoomSourceSlice,
	span: ZoomTrackSpan,
	edge: "start" | "end",
	time: number,
): ZoomSliceTrim | null | undefined {
	if (time === span[edge]) return slice.trim ?? undefined;
	if (
		time < span.availableStart ||
		time > span.availableEnd ||
		span.phaseEnd <= span.phaseStart
	)
		return null;
	const phase =
		span.phaseStart +
		((time - span.start) / (span.end - span.start)) *
			(span.phaseEnd - span.phaseStart);
	if (!Number.isFinite(phase)) return null;
	const next = {
		start:
			edge === "start"
				? Math.max(slice.phaseStart, phase)
				: (slice.trim?.start ?? slice.phaseStart),
		end:
			edge === "end"
				? Math.min(slice.phaseEnd, phase)
				: (slice.trim?.end ?? slice.phaseEnd),
	};
	if (next.end <= next.start) return null;
	return next.start - slice.phaseStart < 1e-7 &&
		slice.phaseEnd - next.end < 1e-7
		? undefined
		: next;
}

export function prepareZoomSliceMove(
	slices: readonly ZoomSourceSlice[],
	span: ZoomTrackSpan,
) {
	const slice = slices[span.sliceIndex];
	const attachment = slice?.attachment;
	if (
		!slice ||
		attachment?.kind !== "clip" ||
		slice.sourceEnd == null ||
		span.sourceRate <= 0 ||
		span.phaseEnd <= span.phaseStart ||
		slice.sourceEnd <= attachment.sourceTime
	)
		return null;
	const start = Math.max(slice.phaseStart, span.phaseStart);
	const end = Math.min(slice.phaseEnd, span.phaseEnd);
	if (end <= start) return null;
	const phaseBounds = [slice.phaseStart];
	if (start - slice.phaseStart > 1e-7) phaseBounds.push(start);
	const selected = phaseBounds.length - 1;
	if (slice.phaseEnd - end > 1e-7) phaseBounds.push(end);
	phaseBounds.push(slice.phaseEnd);
	const rate =
		(slice.sourceEnd - attachment.sourceTime) /
		(slice.phaseEnd - slice.phaseStart);
	const atPhase = (phase: number) =>
		attachment.sourceTime + (phase - slice.phaseStart) * rate;
	const parts = phaseBounds.slice(0, -1).map((phaseStart, index) => ({
		...slice,
		phaseStart,
		phaseEnd: phaseBounds[index + 1],
		sourceEnd: atPhase(phaseBounds[index + 1]),
		trim: index === selected ? undefined : slice.trim,
		attachment: {
			...attachment,
			id: index === 0 ? attachment.id : `overlay-${crypto.randomUUID()}`,
			sourceTime: atPhase(phaseStart),
		},
	}));
	return {
		slices: [
			...slices.slice(0, span.sliceIndex),
			...parts,
			...slices.slice(span.sliceIndex + 1),
		],
		index: span.sliceIndex + selected,
		offset: slice.sourceOffset ?? 0,
	};
}
