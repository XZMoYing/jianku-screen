import type { VoiceDeclick, VoiceEq, VoiceEqPreset } from "~/utils/tauri";

export const VOICE_EQ_PRESET_OPTIONS: ReadonlyArray<
	readonly [Exclude<VoiceEqPreset, "custom">, string]
> = [
	["natural", "自然"],
	["clear", "清晰"],
	["warm", "温暖"],
	["bright", "明亮"],
	["broadcast", "播音"],
];

export const VOICE_DECLICK_OPTIONS: ReadonlyArray<
	readonly [VoiceDeclick, string]
> = [
	["off", "关闭"],
	["light", "轻度"],
	["strong", "强力"],
];

export function voiceEqFromPreset(
	preset: VoiceEqPreset,
	base?: Partial<Pick<VoiceEq, "enabled" | "declick">>,
): VoiceEq {
	const enabled = base?.enabled ?? true;
	const declick = base?.declick ?? "off";
	switch (preset) {
		case "clear":
			return {
				enabled,
				preset,
				highPass: true,
				highPassHz: 90,
				low: { hz: 150, gainDb: -1.5, q: 0.7 },
				lowMid: { hz: 320, gainDb: -3.0, q: 1.2 },
				highMid: { hz: 3500, gainDb: 3.5, q: 0.9 },
				high: { hz: 10000, gainDb: 2.0, q: 0.7 },
				declick,
			};
		case "warm":
			return {
				enabled,
				preset,
				highPass: true,
				highPassHz: 70,
				low: { hz: 160, gainDb: 3.0, q: 0.7 },
				lowMid: { hz: 400, gainDb: -1.0, q: 1.0 },
				highMid: { hz: 3000, gainDb: 1.0, q: 0.8 },
				high: { hz: 9000, gainDb: -2.0, q: 0.7 },
				declick,
			};
		case "bright":
			return {
				enabled,
				preset,
				highPass: true,
				highPassHz: 100,
				low: { hz: 180, gainDb: -2.0, q: 0.7 },
				lowMid: { hz: 350, gainDb: -2.0, q: 1.0 },
				highMid: { hz: 4500, gainDb: 3.0, q: 0.8 },
				high: { hz: 10000, gainDb: 4.5, q: 0.7 },
				declick,
			};
		case "broadcast":
			return {
				enabled,
				preset,
				highPass: true,
				highPassHz: 80,
				low: { hz: 110, gainDb: 3.5, q: 0.7 },
				lowMid: { hz: 380, gainDb: -3.5, q: 1.4 },
				highMid: { hz: 2800, gainDb: 3.0, q: 1.0 },
				high: { hz: 9000, gainDb: 2.5, q: 0.7 },
				declick,
			};
		default:
			return {
				enabled,
				preset,
				highPass: true,
				highPassHz: 80,
				low: { hz: 150, gainDb: 0.0, q: 0.7 },
				lowMid: { hz: 300, gainDb: -2.0, q: 1.0 },
				highMid: { hz: 3500, gainDb: 1.5, q: 0.8 },
				high: { hz: 10000, gainDb: 0.0, q: 0.7 },
				declick,
			};
	}
}
