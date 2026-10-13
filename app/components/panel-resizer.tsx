import { useRef, useState } from "react";

type Props = { label: string; min: number; max: number; /** Current rendered width of the panel. */ measure: () => number; onResize: (width: number) => void; onReset: () => void };

/**
 * A handle on a panel's left edge: drag (or ←/→) to resize, double-click to reset.
 * Pointer capture keeps the drag alive over sketch iframes.
 */
export function PanelResizer({ label, min, max, measure, onResize, onReset }: Props) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const clamp = (width: number) => Math.round(Math.max(min, Math.min(max, width)));
  const end = () => { drag.current = null; setDragging(false); document.body.classList.remove("panel-resizing"); };
  return <div role="separator" aria-orientation="vertical" aria-label={label} aria-valuemin={min} aria-valuemax={max} tabIndex={0}
    title="Drag to resize · double-click to reset" className={`panel-resizer ${dragging ? "dragging" : ""}`}
    onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, width: measure() }; setDragging(true); document.body.classList.add("panel-resizing"); }}
    onPointerMove={event => { if (drag.current) onResize(clamp(drag.current.width + drag.current.x - event.clientX)); }}
    onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
    onDoubleClick={onReset}
    onKeyDown={event => { if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return; event.preventDefault(); onResize(clamp(measure() + (event.key === "ArrowLeft" ? 1 : -1) * (event.shiftKey ? 40 : 10))); }} />;
}
