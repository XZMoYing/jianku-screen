type Snapshot = {
	value: string;
	start: number;
	end: number;
	direction: "forward" | "backward" | "none";
};

const TYPING_GROUP_MS = 600;
const MAX_UNDO_STEPS = 100;

export function bindRecordingTitleInput(
	input: HTMLInputElement,
	updateDraft: (title: string) => void,
	mac: boolean,
) {
	const undo: Snapshot[] = [];
	const redo: Snapshot[] = [];
	const snapshot = (): Snapshot => ({
		value: input.value,
		start: input.selectionStart ?? input.value.length,
		end: input.selectionEnd ?? input.value.length,
		direction: input.selectionDirection ?? "none",
	});
	let current = snapshot();
	let beforeInput: Snapshot | undefined;
	let composition: Snapshot | undefined;
	let group: { type: string; until: number } | undefined;

	function record(
		before: Snapshot,
		after: Snapshot,
		type: string,
		time: number,
	) {
		if (before.value === after.value) return;

		const canGroup =
			(type === "insertText" ||
				type === "deleteContentBackward" ||
				type === "deleteContentForward") &&
			before.start === before.end &&
			after.start === after.end;
		if (
			!canGroup ||
			group?.type !== type ||
			time > group.until ||
			before.start !== current.start ||
			before.end !== current.end
		) {
			undo.push(before);
			if (undo.length > MAX_UNDO_STEPS) undo.shift();
		}
		redo.length = 0;
		group = canGroup ? { type, until: time + TYPING_GROUP_MS } : undefined;
	}

	function replay(redoEdit: boolean, previous: Snapshot) {
		group = undefined;
		beforeInput = undefined;
		const source = redoEdit ? redo : undo;
		const target = redoEdit ? undo : redo;
		const next = source.pop();
		if (next) target.push(previous);
		current = next ?? previous;
		if (input.value !== current.value) input.value = current.value;
		input.setSelectionRange(current.start, current.end, current.direction);
		updateDraft(current.value);
	}

	function historyInput(event: InputEvent) {
		return (
			event.inputType === "historyUndo" || event.inputType === "historyRedo"
		);
	}

	const handleBeforeInput = (event: InputEvent) => {
		if (input.readOnly || composition) return;
		beforeInput = snapshot();
		if (historyInput(event) && event.cancelable) {
			event.preventDefault();
			replay(event.inputType === "historyRedo", beforeInput);
		}
	};

	const handleInput = (event: Event) => {
		const before = beforeInput ?? current;
		beforeInput = undefined;
		const inputType = event instanceof InputEvent ? event.inputType : "";
		if (event instanceof InputEvent && historyInput(event) && !composition) {
			replay(inputType === "historyRedo", before);
			return;
		}
		const after = snapshot();
		if (!composition) record(before, after, inputType, event.timeStamp);
		current = after;
		updateDraft(after.value);
	};

	const handleCompositionStart = () => {
		composition = snapshot();
		group = undefined;
	};

	const handleCompositionEnd = (event: CompositionEvent) => {
		const after = snapshot();
		if (composition) record(composition, after, "", event.timeStamp);
		composition = undefined;
		beforeInput = undefined;
		current = after;
		updateDraft(after.value);
	};

	const handleKeyDown = (event: KeyboardEvent) => {
		if (
			input.readOnly ||
			event.defaultPrevented ||
			event.isComposing ||
			event.keyCode === 229 ||
			composition ||
			event.altKey ||
			(mac ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey)
		)
			return;

		const key = event.key.toLowerCase();
		if (key !== "z" && (mac || key !== "y" || event.shiftKey)) return;
		event.preventDefault();
		replay(event.shiftKey || key === "y", snapshot());
	};

	const handleBlur = () => {
		group = undefined;
		beforeInput = undefined;
	};

	input.addEventListener("beforeinput", handleBeforeInput);
	input.addEventListener("input", handleInput);
	input.addEventListener("compositionstart", handleCompositionStart);
	input.addEventListener("compositionend", handleCompositionEnd);
	input.addEventListener("keydown", handleKeyDown);
	input.addEventListener("blur", handleBlur);

	return {
		reset(title: string) {
			if (input.value !== title) input.value = title;
			current = snapshot();
			undo.length = 0;
			redo.length = 0;
			composition = undefined;
			handleBlur();
		},
		dispose() {
			input.removeEventListener("beforeinput", handleBeforeInput);
			input.removeEventListener("input", handleInput);
			input.removeEventListener("compositionstart", handleCompositionStart);
			input.removeEventListener("compositionend", handleCompositionEnd);
			input.removeEventListener("keydown", handleKeyDown);
			input.removeEventListener("blur", handleBlur);
		},
	};
}
