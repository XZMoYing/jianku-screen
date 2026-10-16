export type SpringState = { value: number; velocity: number };

export function sampleSpring(
	state: SpringState,
	target: number,
	seconds: number,
	response = 0.38,
	damping = 1,
): SpringState {
	const time = Math.max(0, seconds);
	const omega = (2 * Math.PI) / response;
	const displacement = state.value - target;
	const decay = Math.exp(-damping * omega * time);
	if (damping >= 1) {
		const b = state.velocity + omega * displacement;
		return {
			value: target + (displacement + b * time) * decay,
			velocity: (state.velocity - omega * b * time) * decay,
		};
	}
	const frequency = omega * Math.sqrt(1 - damping ** 2);
	const b = (state.velocity + damping * omega * displacement) / frequency;
	const sine = Math.sin(frequency * time);
	const cosine = Math.cos(frequency * time);
	const position = displacement * cosine + b * sine;
	return {
		value: target + decay * position,
		velocity:
			decay *
			(frequency * (b * cosine - displacement * sine) -
				damping * omega * position),
	};
}

export class InterfaceSpring {
	private state: SpringState;
	private started = 0;
	private response = 0.38;
	private damping = 1;
	target: number;
	constructor(value: number) {
		this.state = { value, velocity: 0 };
		this.target = value;
	}
	read(time: number): SpringState {
		return sampleSpring(
			this.state,
			this.target,
			(time - this.started) / 1000,
			this.response,
			this.damping,
		);
	}
	retarget(target: number, time: number, response = 0.38, damping = 1) {
		this.state = this.read(time);
		this.started = time;
		this.target = target;
		this.response = response;
		this.damping = damping;
	}
}

export function springFrames(response = 0.42, damping = 0.86, duration = 0.65) {
	return Array.from({ length: 61 }, (_, index) => ({
		offset: index / 60,
		progress: sampleSpring(
			{ value: 0, velocity: 0 },
			1,
			(index / 60) * duration,
			response,
			damping,
		).value,
	}));
}
