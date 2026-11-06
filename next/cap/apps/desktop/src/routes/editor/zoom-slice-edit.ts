import type { ZoomSourceSlice, ZoomTrackSpan } from "~/utils/tauri";

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
