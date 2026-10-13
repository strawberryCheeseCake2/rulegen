import { useEffect, useId, useRef, useState } from "react";
import type { MachineTarget } from "../../lib/schema";
import type { NodeMachine } from "../../lib/scene/schema";
import { curvePath, emptyLayoutOverride, machineLayout, type GraphStroke, type LayoutOverride } from "../../lib/scene/machine-layout";

type Point = { x: number; y: number };
type Props = {
  machine: NodeMachine; selectedId: string | null; target: MachineTarget | null; runtimeId: string; busy: boolean;
  /** Moved state boxes and transition labels (saved with the frame). */
  layout?: LayoutOverride;
  /** Annotation mode: dragging draws instead of panning, moving or selecting. */
  annotating: boolean; strokes: GraphStroke[];
  onState: (id: string) => void; onTransition: (id: string) => void; onBackground: () => void; onStroke: (stroke: GraphStroke) => void;
  onMoveState?: (id: string, position: Point) => void; onMoveLabel?: (id: string, offset: Point) => void;
  summary: (stateId: string) => string;
};
type Gesture = { pointer: number; x: number; y: number; moved: boolean } & (
  { mode: "pan"; start: Point; transition?: string } | { mode: "draw"; points: GraphStroke } |
  { mode: "state"; id: string; start: Point } | { mode: "label"; id: string; start: Point });

/**
 * States and semantic transition labels. Drag a state box or a label to move
 * it, drag the background (or scroll) to pan, double-click to reset the view.
 * A click without moving selects; in annotation mode a drag draws instead.
 */
export function MachineGraph({ machine, selectedId, target, runtimeId, busy, layout: saved, annotating, strokes, onState, onTransition, onBackground, onStroke, onMoveState, onMoveLabel, summary }: Props) {
  const marker = useId().replace(/[^a-zA-Z0-9]/g, "");
  const viewport = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [draft, setDraft] = useState<GraphStroke | null>(null);
  // The item being dragged follows the pointer locally and is saved on release.
  const [moving, setMoving] = useState<{ kind: "state" | "label"; id: string; point: Point } | null>(null);
  const override = saved || emptyLayoutOverride();
  const live: LayoutOverride = moving ? { states: moving.kind === "state" ? { ...override.states, [moving.id]: moving.point } : override.states, labels: moving.kind === "label" ? { ...override.labels, [moving.id]: moving.point } : override.labels } : override;
  const layout = machineLayout(machine, live);
  const gesture = useRef<Gesture | null>(null);
  const current = useRef({ pan, onStroke }); current.current = { pan, onStroke };
  // Wheel/trackpad pans the graph (non-passive so the page does not scroll).
  useEffect(() => {
    const element = viewport.current; if (!element) return;
    const wheel = (e: WheelEvent) => { e.preventDefault(); setPan(p => ({ x: p.x - e.deltaX, y: p.y - e.deltaY })); };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);
  const graphPoint = (e: React.PointerEvent) => { const box = viewport.current!.getBoundingClientRect(); return { x: e.clientX - box.left - current.current.pan.x, y: e.clientY - box.top - current.current.pan.y }; };
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    const element = e.target as Element, base = { pointer: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    const stateId = element.closest<HTMLElement>(".machine-state")?.dataset.stateId, labelId = element.closest<SVGElement>(".transition-label")?.dataset.transitionId;
    const hitId = element.closest<SVGElement>(".transition-hit")?.dataset.transitionId;
    if (annotating && e.button === 0) { const points = [graphPoint(e)]; gesture.current = { ...base, mode: "draw", points }; setDraft(points); }
    else if (e.button === 0 && stateId) { const box = layout.states.find(state => state.id === stateId)!; gesture.current = { ...base, mode: "state", id: stateId, start: { x: box.x, y: box.y } }; }
    else if (e.button === 0 && labelId) gesture.current = { ...base, mode: "label", id: labelId, start: override.labels[labelId] || { x: 0, y: 0 } };
    else gesture.current = { ...base, mode: "pan", start: pan, transition: e.button === 0 ? hitId : undefined };
    e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const g = gesture.current; if (!g || g.pointer !== e.pointerId) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) g.moved = true;
    if (g.mode === "pan") setPan({ x: g.start.x + dx, y: g.start.y + dy });
    else if (g.mode === "draw") { if (g.points.length < 600) { g.points = [...g.points, graphPoint(e)]; setDraft(g.points); } }
    else if (g.moved) setMoving({ kind: g.mode, id: g.id, point: g.mode === "state" ? { x: Math.max(0, g.start.x + dx), y: Math.max(0, g.start.y + dy) } : { x: g.start.x + dx, y: g.start.y + dy } });
  };
  const up = (e: React.PointerEvent) => {
    const g = gesture.current; if (!g || g.pointer !== e.pointerId) return;
    gesture.current = null;
    const cancelled = e.type === "pointercancel";
    if (g.mode === "draw") { setDraft(null); if (g.points.length > 1 && !cancelled) current.current.onStroke(g.points); return; }
    if (g.mode === "state" || g.mode === "label") {
      const placed = moving; setMoving(null);
      if (cancelled) return;
      if (g.moved && placed) (g.mode === "state" ? onMoveState : onMoveLabel)?.(g.id, placed.point);
      else if (!g.moved && !busy) (g.mode === "state" ? onState : onTransition)(g.id);
      return;
    }
    if (!g.moved && !cancelled && e.button === 0) { if (g.transition) { if (!busy) onTransition(g.transition); } else onBackground(); }
  };
  const pickedTransition = target?.kind === "transition" ? target.id : null, pickedState = target?.kind === "state" ? target.id : null;
  const line = (stroke: GraphStroke) => stroke.map(p => `${p.x},${p.y}`).join(" ");
  return <div ref={viewport} className={`machine-graph-viewport ${annotating ? "annotating-graph" : ""} ${gesture.current?.mode === "pan" ? "panning-graph" : ""} ${moving ? "moving-graph-item" : ""}`}
    onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
    onDoubleClick={e => { if (!annotating && !(e.target as Element).closest(".machine-state, .transition-label, .transition-hit")) setPan({ x: 0, y: 0 }); }}>
    <div className="machine-graph" style={{ width: layout.width, height: layout.height, transform: `translate(${pan.x}px, ${pan.y}px)` }} role="group" aria-label="Node states">
      <svg className="machine-edges" width={layout.width} height={layout.height} role="img" aria-label="Semantic state transitions"><defs><marker id={marker} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0L7 3.5L0 7" fill="context-stroke" /></marker></defs>{layout.edges.map(edge => {
        const active = edge.from === runtimeId, picked = pickedTransition === edge.id, path = curvePath(edge.curve);
        return <g key={edge.id} className={`machine-transition-edge ${active ? "active-transition" : ""} ${picked ? "selected-transition" : ""}`}><title>{edge.description}</title>
          <path d={path} className={`transition-path ${edge.event ? "event-edge" : ""} ${active ? "active-edge" : ""}`} markerEnd={`url(#${marker})`} />
          <path d={path} className="transition-hit" data-transition-id={edge.id} />
          <g className={`transition-label ${moving?.kind === "label" && moving.id === edge.id ? "dragging" : ""}`} data-transition-id={edge.id} transform={`translate(${edge.labelPoint.x},${edge.labelPoint.y})`} role="button" tabIndex={0} aria-pressed={picked} aria-label={`Select transition ${edge.fullLabel}`}
            onKeyDown={e => { if ((e.key === "Enter" || e.key === " ") && !busy && !annotating) { e.preventDefault(); onTransition(edge.id); } }}>
            <rect x={-edge.labelWidth / 2} y={-10} width={edge.labelWidth} height={20} rx={4} /><text textAnchor="middle" dominantBaseline="central">{edge.label}</text></g>
        </g>;
      })}</svg>
      {layout.states.map(state => <button key={state.id} data-state-id={state.id} className={`machine-state ${selectedId === state.id ? "selected-state" : ""} ${pickedState === state.id ? "attached-state" : ""} ${runtimeId === state.id ? "current-state" : ""} ${moving?.kind === "state" && moving.id === state.id ? "dragging" : ""}`} style={{ left: state.x, top: state.y }}
        aria-label={`Select state ${state.label}`} aria-pressed={pickedState === state.id} disabled={busy}
        // Pointer clicks are handled on release (a drag moves instead); this keeps keyboard activation.
        onClick={e => { if (e.detail === 0 && !annotating) onState(state.id); }}>
        <span><i /><strong>{state.label}</strong></span><small>{summary(state.id)}{state.initial ? " · initial" : ""}</small></button>)}
      <svg className="machine-annotations" width={layout.width} height={layout.height} aria-hidden="true">
        {strokes.map((stroke, i) => <polyline key={i} points={line(stroke)} />)}
        {draft && <polyline points={line(draft)} />}
      </svg>
    </div>
    {annotating && <div className="machine-annotate-hint">Annotation · drag to draw, scroll to pan</div>}
  </div>;
}
