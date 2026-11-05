import { describe, expect, it, vi } from "vitest";
import { bindRecordingTitleInput } from "./recording-title-input";

function setup(mac = true) {
	const input = document.createElement("input");
	input.value = "Original title";
	input.setSelectionRange(input.value.length, input.value.length);
	const onDraft = vi.fn();
	const binding = bindRecordingTitleInput(input, onDraft, mac);

	function edit(value: string, type = "insertText") {
		input.dispatchEvent(
			new InputEvent("beforeinput", { inputType: type, cancelable: true }),
		);
		input.value = value;
		input.setSelectionRange(value.length, value.length);
		input.dispatchEvent(new InputEvent("input", { inputType: type }));
	}

	function key(key: string, shiftKey = false) {
		const event = new KeyboardEvent("keydown", {
			key,
			shiftKey,
			metaKey: mac,
			ctrlKey: !mac,
			cancelable: true,
		});
		input.dispatchEvent(event);
		return event;
	}

	return { input, onDraft, binding, edit, key };
}

describe("recording title input history", () => {
	it("coalesces typing and restores the caret through Undo and Redo", () => {
		const { input, key, edit, onDraft } = setup();
		edit("Original title a");
		edit("Original title ab");
		expect(key("z").defaultPrevented).toBe(true);
		expect(input.value).toBe("Original title");
		expect(input.selectionStart).toBe(14);
		expect(key("Z", true).defaultPrevented).toBe(true);
		expect(input.value).toBe("Original title ab");
		expect(onDraft).toHaveBeenLastCalledWith("Original title ab");
	});

	it("restores a replaced selection and drops Redo when typing again", () => {
		const { input, key, edit } = setup(false);
		input.setSelectionRange(0, 8, "backward");
		edit("Renamed title", "insertFromPaste");
		key("z");
		expect(input.value).toBe("Original title");
		expect([
			input.selectionStart,
			input.selectionEnd,
			input.selectionDirection,
		]).toEqual([0, 8, "backward"]);
		expect(key("y").defaultPrevented).toBe(true);
		expect(input.value).toBe("Renamed title");
		key("z");
		edit("New title");
		key("y");
		expect(input.value).toBe("New title");
	});

	it("keeps composition under the IME and undoes the committed word together", () => {
		const { input, key, edit } = setup();
		input.dispatchEvent(new CompositionEvent("compositionstart"));
		edit("Original title 记", "insertCompositionText");
		expect(key("z").defaultPrevented).toBe(false);
		edit("Original title 记录", "insertCompositionText");
		input.dispatchEvent(new CompositionEvent("compositionend"));
		key("z");
		expect(input.value).toBe("Original title");
	});

	it("uses the same draft history for a native history request and clears it on reset", () => {
		const { input, key, edit, binding } = setup();
		edit("Edited title");
		const nativeUndo = new InputEvent("beforeinput", {
			inputType: "historyUndo",
			cancelable: true,
		});
		input.dispatchEvent(nativeUndo);
		expect(nativeUndo.defaultPrevented).toBe(true);
		expect(input.value).toBe("Original title");
		binding.reset("Saved title");
		key("Z", true);
		expect(input.value).toBe("Saved title");
	});
});
