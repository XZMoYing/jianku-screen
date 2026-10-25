import { ASPECT_RATIOS } from "~/routes/editor/projectConfig";
import type { AspectRatio, BackgroundConfiguration, XY } from "~/utils/tauri";

export const SCREEN_MAX_PADDING = 0.4;

const roundBaseDimension = (value: number) =>
	Math.max((Math.ceil(value) + 1) & ~1, 2);

const roundAutoBaseDimension = (value: number) => (Math.floor(value) + 1) & ~1;

function getAspectRatioValue(aspectRatio: AspectRatio) {
	const [width, height] = ASPECT_RATIOS[aspectRatio].ratio;
	return width / height;
}

function getBaseSize(
	cropWidth: number,
	cropHeight: number,
	paddingFactor: number,
	aspectRatio: AspectRatio | null,
) {
	if (aspectRatio === null) {
		const scale = 1 + paddingFactor * 2;
		return {
			width: roundAutoBaseDimension(cropWidth * scale),
			height: roundAutoBaseDimension(cropHeight * scale),
		};
	}

	// Native crop aspect uses f32 before choosing the fitted dimension.
	const cropAspect = Math.fround(cropWidth / cropHeight);
	const targetAspect = getAspectRatioValue(aspectRatio);
	const padding = Math.max(cropWidth, cropHeight) * paddingFactor * 2;

	if (cropAspect > targetAspect) {
		const width = cropWidth + padding;
		const height = width / targetAspect;
		return {
			width: roundBaseDimension(width),
			height: roundBaseDimension(height),
		};
	}

	const height = cropHeight + padding;
	const width = height * targetAspect;
	return {
		width: roundBaseDimension(width),
		height: roundBaseDimension(height),
	};
}

function baseImageTransform(
	frameSize: { width: number; height: number },
	imageSize: { width: number; height: number },
	padding: number,
	crop: { position: XY<number>; size: XY<number> } | null,
	aspectRatio: AspectRatio | null,
) {
	const cropWidth = crop?.size.x ?? imageSize.width;
	const cropHeight = crop?.size.y ?? imageSize.height;

	if (
		frameSize.width <= 0 ||
		frameSize.height <= 0 ||
		cropWidth <= 0 ||
		cropHeight <= 0
	) {
		return {
			offset: { x: 0, y: 0 },
			size: {
				width: Math.max(frameSize.width, 0),
				height: Math.max(frameSize.height, 0),
			},
		};
	}

	const croppedAspect = cropWidth / cropHeight;
	const outputAspect = frameSize.width / frameSize.height;

	const paddingFactor = (padding / 100.0) * SCREEN_MAX_PADDING;
	const baseSize = getBaseSize(
		cropWidth,
		cropHeight,
		paddingFactor,
		aspectRatio,
	);
	const outputScale = Math.min(
		frameSize.width / Math.max(baseSize.width, 1),
		frameSize.height / Math.max(baseSize.height, 1),
	);

	if (aspectRatio === null) {
		const offsetX = cropWidth * paddingFactor * outputScale;
		const offsetY = cropHeight * paddingFactor * outputScale;

		return {
			offset: { x: offsetX, y: offsetY },
			size: {
				width: Math.max(frameSize.width - offsetX * 2, 1),
				height: Math.max(frameSize.height - offsetY * 2, 1),
			},
		};
	}

	const cropBasis = Math.max(cropWidth, cropHeight);
	const maxPadding = Math.max(
		Math.min((frameSize.width - 1) / 2, (frameSize.height - 1) / 2),
		0,
	);
	const paddingPixels = Math.min(
		cropBasis * paddingFactor * outputScale,
		maxPadding,
	);

	const availableWidth = Math.max(frameSize.width - 2 * paddingPixels, 1);
	const availableHeight = Math.max(frameSize.height - 2 * paddingPixels, 1);

	const isHeightConstrained = croppedAspect <= outputAspect;

	let targetWidth: number;
	let targetHeight: number;
	if (isHeightConstrained) {
		targetHeight = availableHeight;
		targetWidth = availableHeight * croppedAspect;
	} else {
		targetWidth = availableWidth;
		targetHeight = availableWidth / croppedAspect;
	}

	const targetOffsetX = (frameSize.width - targetWidth) / 2;
	const targetOffsetY = (frameSize.height - targetHeight) / 2;

	const offsetX = isHeightConstrained ? targetOffsetX : paddingPixels;
	const offsetY = isHeightConstrained ? paddingPixels : targetOffsetY;

	return {
		offset: { x: offsetX, y: offsetY },
		size: { width: targetWidth, height: targetHeight },
	};
}

type ImageDecoration = Pick<
	BackgroundConfiguration,
	"inset" | "frame" | "displayPosition"
>;

export function calculateImageTransform(
	frameSize: { width: number; height: number },
	imageSize: { width: number; height: number },
	padding: number,
	crop: { position: XY<number>; size: XY<number> } | null,
	aspectRatio: AspectRatio | null,
	decoration?: ImageDecoration,
) {
	const base = baseImageTransform(
		frameSize,
		imageSize,
		padding,
		crop,
		aspectRatio,
	);
	if (!decoration || frameSize.width <= 0 || frameSize.height <= 0) return base;
	const style = decoration.frame?.style ?? "none";
	const inset = Math.min(100, Math.max(0, decoration.inset || 0));
	let offset = { ...base.offset };
	let size = { ...base.size };
	if (inset > 0 || style !== "none") {
		const aspect =
			(crop?.size.x ?? imageSize.width) /
			Math.max(1, crop?.size.y ?? imageSize.height);
		const gap = (inset / 1080) * Math.min(aspect, 1);
		const plateWidth = aspect + gap * 2;
		const plateHeight = 1 + gap * 2;
		const plateAspect = plateWidth / plateHeight;
		let [top, right, bottom, left] = [0, 0, 0, 0];
		if (style === "macOS") top = 0.055;
		else if (style === "windows") top = 0.05;
		else if (style === "browser") top = 0.075;
		else if (style === "macbook")
			[top, right, bottom, left] = [0.028, 0.128, 0.108, 0.128];
		else if (style === "phone" || style === "tablet") {
			const bezel =
				(style === "phone" ? 0.024 : 0.04) *
				Math.min(Math.max(plateAspect, Number.EPSILON), 1);
			[top, right, bottom, left] = [bezel, bezel, bezel, bezel];
		}
		const outerWidth = plateWidth + (left + right) * plateHeight;
		const outerHeight = plateHeight * (1 + top + bottom);
		const height = Math.max(
			1,
			Math.min(base.size.width / outerWidth, base.size.height / outerHeight),
		);
		offset = {
			x:
				base.offset.x +
				(base.size.width - outerWidth * height) / 2 +
				(left * plateHeight + gap) * height,
			y:
				base.offset.y +
				(base.size.height - outerHeight * height) / 2 +
				(top * plateHeight + gap) * height,
		};
		size = { width: aspect * height, height };
	}
	if (decoration.displayPosition) {
		offset.x +=
			(Math.min(1, Math.max(0, decoration.displayPosition.x)) - 0.5) *
			frameSize.width;
		offset.y +=
			(Math.min(1, Math.max(0, decoration.displayPosition.y)) - 0.5) *
			frameSize.height;
	}
	return { offset, size };
}

export function getImageRect(
	frameSize: { width: number; height: number },
	imageSize: { width: number; height: number } | null,
	padding: number,
	crop: { position: XY<number>; size: XY<number> } | null,
	aspectRatio: AspectRatio | null,
	decoration?: ImageDecoration,
) {
	if (!imageSize) {
		return {
			x: 0,
			y: 0,
			width: frameSize.width,
			height: frameSize.height,
		};
	}

	const transform = calculateImageTransform(
		frameSize,
		imageSize,
		padding,
		crop,
		aspectRatio,
		decoration,
	);

	return {
		x: transform.offset.x,
		y: transform.offset.y,
		width: transform.size.width,
		height: transform.size.height,
	};
}

export function remapImageAnnotations<
	T extends { x: number; y: number; width: number; height: number },
>(
	annotations: T[],
	previous: ReturnType<typeof calculateImageTransform>,
	next: ReturnType<typeof calculateImageTransform>,
) {
	const scaleX = next.size.width / Math.max(previous.size.width, 1);
	const scaleY = next.size.height / Math.max(previous.size.height, 1);
	return annotations.map((annotation) => ({
		...annotation,
		x: next.offset.x + (annotation.x - previous.offset.x) * scaleX,
		y: next.offset.y + (annotation.y - previous.offset.y) * scaleY,
		width: annotation.width * scaleX,
		height: annotation.height * scaleY,
	}));
}
