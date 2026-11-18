import { useRef, useState } from "react";

type Props = { label: string; min: number; max: number; /** Current rendered size of the panel (width, or height with axis "y"). */ measure: () => number; onResize: (size: number) => void; onReset: () => void;
  /** "x": a handle on the panel's left edge (width). "y": a handle on its top edge (height). */
  axis?: "x" | "y";
  /** With axis "x": the edge the handle sits on ("left": dragging left grows the panel; "right": dragging right does). */
  edge?: "left" | "right" };

/**
 * A handle on a panel's left or right edge (or top edge): drag (or the arrow keys) to
 * resize, double-click to reset. Pointer capture keeps the drag alive over sketch iframes.
 */
export function PanelResizer({ label, min, max, measure, onResize, onReset, axis = "x", edge = "left" }: Props) {
  const drag = useRef<{ at: number; size: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const clamp = (size: number) => Math.round(Math.max(min, Math.min(max, size)));
  const resizing = axis === "x" ? "panel-resizing" : "panel-resizing-y";
  const end = () => { drag.current = null; setDragging(false); document.body.classList.remove(resizing); };
  const position = (event: React.PointerEvent) => axis === "x" ? event.clientX : event.clientY;
  // How far the pointer moved in the direction that grows the panel.
  const grown = (from: number, to: number) => axis === "x" && edge === "right" ? to - from : from - to;
  const [less, more] = axis === "y" ? ["ArrowDown", "ArrowUp"] : edge === "right" ? ["ArrowLeft", "ArrowRight"] : ["ArrowRight", "ArrowLeft"];
  return <div role="separator" aria-orientation={axis === "x" ? "vertical" : "horizontal"} aria-label={label} aria-valuemin={min} aria-valuemax={max} tabIndex={0}
    title="Drag to resize · double-click to reset" className={`panel-resizer ${axis === "y" ? "panel-resizer-y" : edge === "right" ? "panel-resizer-right" : ""} ${dragging ? "dragging" : ""}`}
    onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { at: position(event), size: measure() }; setDragging(true); document.body.classList.add(resizing); }}
    onPointerMove={event => { if (drag.current) onResize(clamp(drag.current.size + grown(drag.current.at, position(event)))); }}
    onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
    onDoubleClick={onReset}
    onKeyDown={event => { if (event.key !== less && event.key !== more) return; event.preventDefault(); onResize(clamp(measure() + (event.key === more ? 1 : -1) * (event.shiftKey ? 40 : 10))); }} />;
}
