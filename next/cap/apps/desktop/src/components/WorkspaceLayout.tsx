import { makePersisted } from "@solid-primitives/storage";
import { createSignal, type JSX, onCleanup, onMount } from "solid-js";
import { t } from "~/utils/i18n";

export function workspacePaneSize(
	available: number,
	preferred: number,
	minimum: number,
	opposite: number,
	maximum = Number.POSITIVE_INFINITY,
) {
	const space = Math.max(0, Number.isFinite(available) ? available : 0);
	const low = Math.min(minimum, space / 2);
	const high = Math.max(
		low,
		Math.min(maximum, space - Math.min(opposite, space / 2)),
	);
	return Math.min(
		high,
		Math.max(low, Number.isFinite(preferred) ? preferred : low),
	);
}

export default function WorkspaceLayout(props: {
	mode: string;
	source: string;
	menuOpen: boolean;
	preview: JSX.Element;
	inspector: JSX.Element;
	children: JSX.Element;
}) {
	const [inspector, setInspector] = makePersisted(createSignal(328), {
		name: "workspaceInspectorWidth",
	});
	const [controls, setControls] = makePersisted(
		createSignal<number | null>(null),
		{ name: "workspaceControlsHeight" },
	);
	const [width, setWidth] = createSignal(0);
	const [height, setHeight] = createSignal(0);
	const [resizing, setResizing] = createSignal(false);
	let root!: HTMLDivElement;
	let main!: HTMLDivElement;
	let cancelDrag: (() => void) | undefined;
	const controlDefault = () =>
		props.mode === "presentation" || props.source === "mobile" ? 340 : 254;
	const side = () =>
		workspacePaneSize(width() - 12, inspector(), 292, 320, 620);
	const bottom = () =>
		workspacePaneSize(
			height() - 12,
			props.menuOpen ? height() - 192 : (controls() ?? controlDefault()),
			180,
			180,
		);
	const change = (axis: "side" | "bottom", value: number) => {
		if (axis === "side")
			setInspector(workspacePaneSize(width() - 12, value, 292, 320, 620));
		else setControls(workspacePaneSize(height() - 12, value, 180, 180));
	};
	const drag = (axis: "side" | "bottom", event: PointerEvent) => {
		if (event.button !== 0 || (axis === "bottom" && props.menuOpen)) return;
		event.preventDefault();
		cancelDrag?.();
		const target = event.currentTarget;
		if (!(target instanceof HTMLElement)) return;
		const origin = axis === "side" ? event.clientX : event.clientY;
		const initial = axis === "side" ? side() : bottom();
		const initialStored = axis === "side" ? inspector() : controls();
		let latest = initial;
		let frame = 0;
		const flush = () => {
			frame = 0;
			change(axis, latest);
		};
		const move = (next: PointerEvent) => {
			if (next.pointerId !== event.pointerId) return;
			latest =
				initial - ((axis === "side" ? next.clientX : next.clientY) - origin);
			frame ||= requestAnimationFrame(flush);
		};
		const finish = (next?: PointerEvent, revert = false) => {
			if (next && next.pointerId !== event.pointerId) return;
			cancelAnimationFrame(frame);
			if (revert) {
				if (axis === "side") setInspector(initialStored ?? 328);
				else setControls(initialStored);
			} else if (next) {
				latest =
					initial - ((axis === "side" ? next.clientX : next.clientY) - origin);
				flush();
			}
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			window.removeEventListener("pointercancel", abort);
			window.removeEventListener("blur", abort);
			if (target.hasPointerCapture?.(event.pointerId))
				target.releasePointerCapture(event.pointerId);
			setResizing(false);
			cancelDrag = undefined;
		};
		const up = (next: PointerEvent) => finish(next);
		const abort = () => finish(undefined, true);
		cancelDrag = abort;
		setResizing(true);
		target.setPointerCapture?.(event.pointerId);
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
		window.addEventListener("pointercancel", abort);
		window.addEventListener("blur", abort);
	};
	const key = (axis: "side" | "bottom", event: KeyboardEvent) => {
		if (axis === "bottom" && props.menuOpen) return;
		const horizontal = axis === "side";
		const delta =
			event.key === (horizontal ? "ArrowLeft" : "ArrowUp")
				? 10
				: event.key === (horizontal ? "ArrowRight" : "ArrowDown")
					? -10
					: 0;
		if (delta) {
			event.preventDefault();
			change(axis, (horizontal ? side() : bottom()) + delta);
		}
		if (event.key === "Home") {
			event.preventDefault();
			if (horizontal) setInspector(328);
			else setControls(null);
		}
	};
	onMount(() => {
		const measure = () => {
			setWidth(root.clientWidth);
			setHeight(main.clientHeight);
		};
		const observer = new ResizeObserver(measure);
		observer.observe(root);
		observer.observe(main);
		measure();
		onCleanup(() => observer.disconnect());
	});
	onCleanup(() => cancelDrag?.());
	return (
		<div
			ref={root}
			class="jk-workspace-body jk-resizable-workspace"
			data-resizing={resizing()}
			style={{
				"--jk-inspector-width": `${side()}px`,
				"--jk-controls-height": `${bottom()}px`,
			}}
		>
			<div
				ref={main}
				class="jk-workspace-main"
				data-menu-open={props.menuOpen}
				data-mode={props.mode}
				data-source={props.source}
			>
				{props.preview}
				<div
					class="jk-workspace-divider jk-workspace-divider-row"
					role="separator"
					tabIndex={0}
					aria-label={t("调整首页预览与控制区高度")}
					aria-orientation="horizontal"
					aria-valuenow={Math.round(bottom())}
					onPointerDown={[drag, "bottom"]}
					onKeyDown={[key, "bottom"]}
					onDblClick={() => setControls(null)}
				>
					<span />
				</div>
				<div class="jk-workspace-controls">{props.children}</div>
			</div>
			<div
				class="jk-workspace-divider jk-workspace-divider-column"
				role="separator"
				tabIndex={0}
				aria-label={t("调整首页画面设置宽度")}
				aria-orientation="vertical"
				aria-valuenow={Math.round(side())}
				onPointerDown={[drag, "side"]}
				onKeyDown={[key, "side"]}
				onDblClick={() => setInspector(328)}
			>
				<span />
			</div>
			{props.inspector}
		</div>
	);
}
