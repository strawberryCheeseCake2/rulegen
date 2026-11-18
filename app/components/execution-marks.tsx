import { useRef, useState } from "react";

// Inspection annotation: marks drawn on the inspected frame's picture (not sketch strokes) pointing at what the
// concern is about; they go to AI with the concern. Drawn while the inspection annotation tool is chosen; shown
// while the frame is inspected.

type Point = { x: number; y: number };

export function ExecutionMarks({ marks, active, color, onAdd }: { marks: Point[][]; active: boolean; color: string; onAdd: (points: Point[]) => void }) {
  const [drawing, setDrawing] = useState<Point[] | null>(null);
  const layer = useRef<HTMLDivElement>(null);
  const at = (event: React.PointerEvent) => {
    const box = layer.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)), y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)) };
  };
  const path = (points: Point[]) => points.map(point => `${point.x * 900},${point.y * 600}`).join(" ");
  if (!active && !marks.length) return null;
  return <div ref={layer} className={`exec-marks ${active ? "active" : ""}`} aria-label="Inspection annotation"
    onPointerDown={active ? event => { if (event.button !== 0) return; event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setDrawing([at(event)]); } : undefined}
    onPointerMove={active ? event => { if (!drawing) return; event.stopPropagation(); const point = at(event), last = drawing[drawing.length - 1]; if (Math.hypot((point.x - last.x) * 900, (point.y - last.y) * 600) >= 2 && drawing.length < 400) setDrawing([...drawing, point]); } : undefined}
    onPointerUp={active ? event => { event.stopPropagation(); if (drawing && drawing.length > 1) onAdd(drawing); setDrawing(null); } : undefined}>
    <svg viewBox="0 0 900 600" preserveAspectRatio="none" aria-hidden="true">
      {[...marks, ...(drawing ? [drawing] : [])].map((mark, i) => <polyline key={i} points={path(mark)} stroke={color} />)}
    </svg>
  </div>;
}
