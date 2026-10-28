// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { canExitPreviewOnEscape, markTooltipEscape } from "./tooltip-escape";

const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
	document.body.replaceChildren();
});

function dispatch(consume?: (event: KeyboardEvent) => void, role?: string) {
	const parent = document.createElement("div");
	if (role) parent.setAttribute("role", role);
	const button = document.createElement("button");
	parent.append(button);
	document.body.append(parent);
	const exit = vi.fn();
	const dismiss = (event: KeyboardEvent) => consume?.(event);
	const handle = (event: KeyboardEvent) => {
		if (canExitPreviewOnEscape(event)) exit();
	};
	document.addEventListener("keydown", dismiss);
	window.addEventListener("keydown", handle);
	cleanups.push(() => {
		document.removeEventListener("keydown", dismiss);
		window.removeEventListener("keydown", handle);
	});
	button.dispatchEvent(
		new KeyboardEvent("keydown", {
			key: "Escape",
			bubbles: true,
			cancelable: true,
		}),
	);
	return exit;
}

describe("preview Escape after dismissing a tooltip", () => {
	it("exits on an unhandled Escape", () => {
		expect(dispatch()).toHaveBeenCalledOnce();
	});

	it("exits on the same Escape that closes a tooltip", () => {
		expect(
			dispatch((event) => {
				markTooltipEscape(event);
				event.preventDefault();
			}),
		).toHaveBeenCalledOnce();
	});

	it("lets another dismissable layer consume Escape first", () => {
		expect(dispatch((event) => event.preventDefault())).not.toHaveBeenCalled();
	});

	it.each(["dialog", "alertdialog", "menu", "listbox"])(
		"preserves the %s underneath a tooltip",
		(role) => {
			expect(
				dispatch((event) => {
					markTooltipEscape(event);
					event.preventDefault();
				}, role),
			).not.toHaveBeenCalled();
		},
	);

	it("does not reuse tooltip consumption for another key event", () => {
		const event = new KeyboardEvent("keydown", { key: "Escape" });
		markTooltipEscape(event);
		const next = new KeyboardEvent("keydown", {
			key: "Escape",
			cancelable: true,
		});
		next.preventDefault();
		expect(canExitPreviewOnEscape(next)).toBe(false);
		expect(
			canExitPreviewOnEscape(new KeyboardEvent("keydown", { key: "Enter" })),
		).toBe(false);
	});
});
