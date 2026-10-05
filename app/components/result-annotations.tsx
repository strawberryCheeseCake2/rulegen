import { useRef, useState } from "react";
import { MAX_RESULT_STROKES, ART_WIDTH as W, ART_HEIGHT as H, type ResultAnnotation, type Point } from "../lib/schema";
import { annotationsHitByEraser } from "../lib/annotation-history";

export function ResultAnnotations({ annotations, zoom, tool, disabled, onAdd, onErase }: { annotations: ResultAnnotation[]; zoom: number; tool: string; disabled: boolean; onAdd: (points: Point[]) => void; onErase: (ids: string[]) => void }) {
  const drag = useRef<{ id: number; points: Point[]; erasing: boolean; removed: Set<string> } | null>(null);
  const [draft, setDraft] = useState<Point[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  function erase(from: Point, to: Point) {
    const d = drag.current!;
    for (const id of annotationsHitByEraser(annotations, from, to, zoom)) d.removed.add(id);
    setRemoved([...d.removed]);
  }
  function point(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
  }
  const path = (points: Point[]) => points.map((p, i) => `${i ? "L" : "M"}${p.x * W},${p.y * H}`).join(" ");
  return <svg className={`result-annotation-overlay tool-${tool}`} viewBox={`0 0 ${W} ${H}`} aria-label="Draw annotations on generated result" onPointerDown={e => {
    if (disabled || (tool !== "pen" && tool !== "eraser") || (tool === "pen" && annotations.length >= MAX_RESULT_STROKES) || e.button !== 0 || e.altKey) return;
    e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
    const points = [point(e)]; drag.current = { id: e.pointerId, points, erasing: tool === "eraser", removed: new Set() }; if (tool === "eraser") erase(points[0], points[0]); else setDraft(points);
  }} onPointerMove={e => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    const p = point(e), last = d.points[d.points.length - 1];
    if (d.erasing) { erase(last, p); d.points = [p]; return; }
    if (d.points.length >= 600) return;
    if (Math.hypot((p.x - last.x) * W, (p.y - last.y) * H) < 2) return;
    d.points.push(p); setDraft([...d.points]);
  }} onPointerUp={e => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    if (d.erasing) erase(d.points[d.points.length - 1], point(e));
    drag.current = null; setDraft([]); setRemoved([]); e.currentTarget.releasePointerCapture(e.pointerId);
    if (d.erasing) { onErase([...d.removed]); return; }
    if (d.points.length === 1) d.points.push({ x: Math.min(1, d.points[0].x + .01), y: d.points[0].y });
    onAdd(d.points);
  }} onPointerCancel={() => { drag.current = null; setDraft([]); setRemoved([]); }}>
    {annotations.map(a => removed.includes(a.id) ? null : <path key={a.id} d={path(a.points)} fill="none" stroke="#db624a" strokeWidth="3" vectorEffect="non-scaling-stroke" />)}
    <path d={path(draft)} fill="none" stroke="#db624a" strokeWidth="3" vectorEffect="non-scaling-stroke" />
  </svg>;
}
