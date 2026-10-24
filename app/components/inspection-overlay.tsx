import { useId, useRef, useState } from "react";
import { ART_HEIGHT as H, ART_WIDTH as W } from "../lib/schema";
import { suggestedValues } from "../lib/hidden-parameters";
import { clampValue, dragValue, handleGrips, heldIndex, historyOverlays, itemIdOf, layoutLabels, sameFocus as same, startDrag, stepBadges, stepContext, type HandleDrag, type HandleGrip, type PlacedOverlay, markStyleAt, type InspectionFocus, type InspectionState, type InspectResult, type MarkStyle, type Scalar } from "../lib/inspection";
import type { ScalarValue } from "../lib/scene/schema";

type Props = {
  state: InspectionState;
  /** The inspection annotation being drawn (only while annotating; a targeted tool keeps its marks for AI but does not draw them) and the tool's overlays. */
  marks: InspectionState["marks"]; result: InspectResult | null;
  /** The stores as the held step is drawn now by the running code (newer than its recording), when the held step is the one looked at. */
  drawn?: Record<string, unknown> | null;
  /** Each mark's color, width (canvas pixels) and opacity, by index. */
  markStyles?: MarkStyle[];
  /** Values when following the running result (no step selected). */
  liveValues: Record<string, Scalar>;
  /** Overlays react to clicks only with an inspection tool (not while annotating). */
  clickable: boolean; zoom: number;
  onFocus: (focus: InspectionFocus | null) => void;
  /** Go to a recorded step (clicking its ghost on the frame), and how that step is named on hover. */
  onStep?: (index: number) => void; stepName?: (index: number) => string;
  /** The spec (range, step) of each value a handle may change, and dragging one: the value as it is dragged (start, every move, end). */
  specs?: Record<string, ScalarValue>;
  /** `item`: the id of the drawn item the grip is on (its what-if is that item's only, when the code reads the value per item). */
  /** `item`: the id of the drawn item the grip is on; `each`: the grip is on one item of an `each` overlay (with an id or not). */
  onHandle?: (phase: "start" | "move" | "end", key: string, value: number | boolean | null, item: string | null, each: boolean,
    /** How far the pointer has gone from where the drag began, and how far that was from the pivot (a "drag" has none: Infinity), in canvas pixels. */
    motion?: { moved: number; reach: number }) => void;
  /** One moment only (an exploration frame): no step badge, step numbers or path through the steps. */
  plain?: boolean;
};

/**
 * Over a frame while one of its brush's inspection tools is active (the result
 * underneath is held at the selected step's runtime state): the inspection annotation and the targeted overlays,
 * computed from that step's values.
 */
/** Labels drawn per overlay at most (an overlay drawn once per item labels only its first items). */
const LABELS_PER_OVERLAY = 3;
const shapeOf = (kind: string, x: number, y: number, w: number, h: number, props: object) => kind === "rect" ? <rect x={Math.min(x, x + w)} y={Math.min(y, y + h)} width={Math.abs(w)} height={Math.abs(h)} {...props} />
  : kind === "ellipse" ? <ellipse cx={x + w / 2} cy={y + h / 2} rx={Math.abs(w / 2)} ry={Math.abs(h / 2)} {...props} />
  : kind === "line" ? <line x1={x} y1={y} x2={x + w} y2={y + h} {...props} /> : null;

export function InspectionOverlay({ state, marks, markStyles, result, drawn, liveValues, clickable, zoom, onFocus, onStep, stepName, specs, onHandle, plain }: Props) {
  // The step being looked at (the latest unless another is picked): overlays are recomputed from its values and stores; the other steps show as ghosts.
  const index = heldIndex(state) ?? -1, step = state.steps[index];
  // Suggested parameters are read at the value the code uses wherever a step does not record them (not accepted yet, or recorded before).
  const fallback = result ? suggestedValues(result.parameters) : undefined;
  // A handle drag sets a what-if value of this step (its `edits`), so the overlays here are recomputed with it.
  const placed = result ? historyOverlays(result.overlays, state.steps, index, liveValues, drawn, fallback) : [];
  const svg = useRef<SVGSVGElement>(null);
  const dragging = useRef<{ grip: HandleGrip; drag: HandleDrag; pointerId: number } | null>(null);
  const [active, setActive] = useState<{ key: string; grip: string; value: number | boolean | null } | null>(null);
  const grips = result && clickable && onHandle ? handleGrips(result.overlays, stepContext(state.steps, index, liveValues, drawn, fallback)) : [];
  /** The pointer in canvas pixels (the SVG spans the 900×600 canvas). */
  const canvasPoint = (e: React.PointerEvent) => { const box = svg.current!.getBoundingClientRect(); return { x: (e.clientX - box.left) / Math.max(1, box.width) * W, y: (e.clientY - box.top) / Math.max(1, box.height) * H }; };
  const moveHandle = (e: React.PointerEvent, phase: "move" | "end") => {
    const current = dragging.current; if (!current || current.pointerId !== e.pointerId) return;
    e.preventDefault(); e.stopPropagation();
    const value = clampValue(specs?.[current.grip.handle.key], dragValue(current.grip, current.drag, canvasPoint(e)));
    const item = itemIdOf(current.grip.scope.item), each = Boolean(current.grip.overlay.each), pointer = canvasPoint(e), drag = current.drag;
    const motion = { moved: Math.hypot(pointer.x - drag.sx, pointer.y - drag.sy), reach: current.grip.handle.gesture === "drag" ? Infinity : Math.hypot(drag.sx - drag.px, drag.sy - drag.py) };
    if (value !== null) onHandle?.("move", current.grip.handle.key, value, item, each, motion);
    setActive({ key: current.grip.handle.key, grip: current.grip.key, value: value ?? active?.value ?? null });
    if (phase === "end") { dragging.current = null; setActive(null); onHandle?.("end", current.grip.handle.key, value, item, each, motion); }
  };
  const text = 12 / Math.max(.2, zoom);
  const uid = useId().replace(/:/g, ""), badge = 7 / Math.max(.2, zoom);
  // One number per step and overlay (an overlay drawn per item numbers its first item only), and the path through those spots in step order.
  const marked = placed.filter(item => item.key.endsWith(":0"));
  const spotOf = (item: PlacedOverlay) => {
    const right = Math.max(item.x, item.x + item.w), top = Math.min(item.y, item.y + item.h);
    return item.overlay.kind === "line" ? { x: item.x + item.w, y: item.y + item.h } : item.overlay.kind === "label" ? { x: item.x - badge * 1.6, y: item.y - badge } : { x: right, y: top };
  };
  // Every step has a badge, also where its overlay sits exactly where another step's does (those share one badge and are walked through by clicking it).
  const badges = result && !plain ? stepBadges(result.overlays, state.steps, index, spotOf, liveValues, drawn, fallback) : [];
  const paths = (plain ? [] : result?.overlays ?? []).filter(overlay => !overlay.each).map(overlay => ({ overlay, points: marked.filter(item => item.overlay.id === overlay.id).sort((a, b) => a.step - b.step)
    .map(item => item.overlay.kind === "line" || item.overlay.kind === "label" ? { x: item.x, y: item.y } : { x: item.x + item.w / 2, y: item.y + item.h / 2 }) }))
    .filter(path => path.points.length > 1 && path.points.some(point => Math.hypot(point.x - path.points[0].x, point.y - path.points[0].y) > 2));
  const current = placed.filter(item => !item.ghost), byKey = new Map(current.map(item => [item.key, item]));
  const counts = new Map<string, number>();
  const labels = layoutLabels(current.filter(item => item.label && (counts.set(item.overlay.id, (counts.get(item.overlay.id) ?? 0) + 1).get(item.overlay.id)! <= LABELS_PER_OVERLAY)).map(item => ({
    key: item.key, text: item.label, shape: item.overlay.kind === "label" ? { x: item.x, y: item.y, w: 0, h: 0 } : { x: item.x, y: item.y, w: item.w, h: item.h },
    anchor: item.overlay.kind === "line" ? { x: item.x + item.w, y: item.y + item.h } : item.overlay.kind === "label" ? { x: item.x, y: item.y } : { x: Math.min(item.x, item.x + item.w), y: Math.min(item.y, item.y + item.h) - 4 },
  })), text, { width: W, height: H }, badges.map(item => ({ x: item.x - badge, y: item.y - badge, width: badge * 2, height: badge * 2 })));
  return <div className="inspection-overlay" aria-label="Inspection overlay">
    {step && !plain && <span className="inspection-step-badge">Step {index + 1} / {state.steps.length}</span>}
    <svg ref={svg} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {marks.map((mark, i) => { const style = markStyleAt(markStyles, i);
        return <polyline key={i} className="inspection-mark" points={mark.map(p => `${p.x * W},${p.y * H}`).join(" ")} style={{ stroke: style.color, strokeWidth: style.width, opacity: style.opacity }} />; })}
      {placed.map(({ overlay, key, x, y, w, h, step: at, ghost }) => {
        const focused = same(state.focus, overlay.link), props = { stroke: overlay.color, className: `inspection-shape ${focused ? "focused" : ""}`, vectorEffect: "non-scaling-stroke" as const };
        // A ghost of another step (earlier: solid, later: dashed), fainter the farther it is; clicking it goes to that step.
        if (ghost) {
          const go = clickable && onStep, name = `Step ${at + 1}${stepName ? ` · ${stepName(at)}` : ""}`;
          return <g key={key} className={`inspection-ghost ${ghost > 0 ? "later" : "earlier"} ${go ? "clickable" : ""}`} opacity={Math.max(.14, .5 - (Math.abs(ghost) - 1) * .06)}
            role={go ? "button" : undefined} aria-label={go ? `Go to ${name}` : undefined}
            onPointerDown={e => { if (!go) return; e.preventDefault(); e.stopPropagation(); onStep!(at); }}>
            <title>{name}</title>
            {shapeOf(overlay.kind, x, y, w, h, { ...props, className: "inspection-shape" }) ?? <circle cx={x} cy={y} r={4} fill={overlay.color} />}
            {/* A wider invisible outline, so a thin ghost is easy to hit. */}
            {go && shapeOf(overlay.kind, x, y, w, h, { className: `inspection-ghost-hit ${Math.max(Math.abs(w), Math.abs(h)) <= 80 ? "solid" : ""}`, vectorEffect: "non-scaling-stroke" as const })}</g>;
        }
        const shape = shapeOf(overlay.kind, x, y, w, h, props);
        return shape && <g key={key} className={`inspection-item ${clickable ? "clickable" : ""}`} role={clickable ? "button" : undefined} aria-label={clickable ? `Highlight ${overlay.link.kind} ${overlay.link.id}` : undefined}
          onPointerDown={e => { if (!clickable) return; e.stopPropagation(); onFocus(focused ? null : overlay.link); }}>{shape}</g>;
      })}
      {/* Order: a faint path through the steps (arrows point forward) and each step's number. */}
      <defs>{result?.overlays.map(overlay => <marker key={overlay.id} id={`${uid}-${overlay.id}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
        <path d="M0,0 L8,4 L0,8 z" fill={overlay.color} /></marker>)}</defs>
      {paths.map(({ overlay, points }) => <polyline key={`path:${overlay.id}`} className="inspection-order-path" points={points.map(point => `${point.x},${point.y}`).join(" ")} stroke={overlay.color} vectorEffect="non-scaling-stroke"
        markerMid={`url(#${uid}-${overlay.id})`} markerEnd={`url(#${uid}-${overlay.id})`} />)}
      {badges.map(({ key, overlay, x, y, steps, shown, next, current }) => {
        // The badge of the step looked at is filled; one shared by other steps walks to the next of them on click.
        const go = Boolean(clickable && onStep && next !== index), ghost = current ? 0 : shown - index, more = steps.length - 1;
        const names = steps.map(j => `Step ${j + 1}${stepName ? ` · ${stepName(j)}` : ""}`).join("\n");
        return <g key={`badge:${key}`} className={`inspection-badge ${current ? "current" : "ghost"} ${go ? "clickable" : ""}`} opacity={current ? 1 : Math.max(.35, .8 - (Math.abs(ghost) - 1) * .08)}
          onPointerDown={e => { if (!go) return; e.preventDefault(); e.stopPropagation(); onStep!(next); }}>
          <title>{more ? `${names}\n(같은 자리의 단계 ${steps.length}개 · 클릭하면 Step ${next + 1})` : names}</title>
          <circle cx={x} cy={y} r={badge} fill={current ? overlay.color : "#fffefa"} stroke={overlay.color} vectorEffect="non-scaling-stroke" />
          <text x={x} y={y} fontSize={badge * 1.25} fill={current ? "#fff" : overlay.color} textAnchor="middle" dominantBaseline="central">{shown + 1}</text>
          {more > 0 && <text x={x + badge * 1.15} y={y - badge * .9} fontSize={badge * .95} fill={overlay.color} className="inspection-badge-more">+{more}</text>}
        </g>;
      })}
      {labels.map(label => {
        const item = byKey.get(label.key)!, overlay = item.overlay, focused = same(state.focus, overlay.link);
        const tx = Math.min(Math.max(label.x, Math.min(item.x, item.x + item.w)), Math.max(item.x, item.x + item.w));
        return <g key={`label:${label.key}`} className={`inspection-item ${clickable ? "clickable" : ""}`} onPointerDown={e => { if (!clickable) return; e.stopPropagation(); onFocus(focused ? null : overlay.link); }}>
          {label.leader && <line className="inspection-leader" x1={tx} y1={label.y > item.y ? label.y - label.height * .8 : label.y + label.height * .2} x2={tx} y2={label.y > item.y ? Math.max(item.y, item.y + item.h) : Math.min(item.y, item.y + item.h)} stroke={overlay.color} vectorEffect="non-scaling-stroke" />}
          <text x={label.x} y={label.y} fontSize={text} fill={overlay.color} className="inspection-label">{label.text}</text>
        </g>;
      })}
      {/* Handles: drag one to change the value it shows; the result and the overlay follow. */}
      {grips.map(grip => {
        const r = 6.5 / Math.max(.2, zoom), moving = active?.grip === grip.key, current = dragging.current?.grip.key === grip.key ? dragging.current : null;
        const guide = moving && current ? (grip.handle.gesture === "rotate" ? <circle cx={current.drag.px} cy={current.drag.py} r={Math.hypot(grip.x - current.drag.px, grip.y - current.drag.py)} />
          : grip.handle.gesture === "slide" ? <line x1={current.drag.px} y1={current.drag.py} x2={current.drag.px + (grip.x - current.drag.px) * 1.6} y2={current.drag.py + (grip.y - current.drag.py) * 1.6} />
          : <line x1={current.drag.sx} y1={current.drag.sy} x2={grip.x} y2={grip.y} />) : null;
        const shown = moving && active?.value !== null && active?.value !== undefined ? `${grip.handle.hint} · ${typeof active.value === "boolean" ? (active.value ? "켜짐" : "꺼짐") : Math.round(Number(active.value) * 100) / 100}` : grip.handle.hint;
        return <g key={grip.key} className={`inspection-grip gesture-${grip.handle.gesture} ${moving ? "dragging" : ""}`} role="slider" aria-label={grip.handle.hint || `Adjust ${grip.handle.key}`}
          aria-valuenow={typeof active?.value === "number" && moving ? active.value : undefined}
          onPointerDown={e => {
            if (e.button !== 0) return;
            e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
            const point = canvasPoint(e);
            dragging.current = { grip, drag: startDrag(grip, point), pointerId: e.pointerId };
            setActive({ key: grip.handle.key, grip: grip.key, value: null });
            onFocus(grip.overlay.link); onHandle?.("start", grip.handle.key, null, itemIdOf(grip.scope.item), Boolean(grip.overlay.each));
          }}
          onPointerMove={e => moveHandle(e, "move")} onPointerUp={e => moveHandle(e, "end")} onPointerCancel={e => moveHandle(e, "end")}>
          <title>{grip.handle.hint}</title>
          {guide && <g className="inspection-grip-guide" stroke={grip.overlay.color}>{guide}</g>}
          {grip.handle.gesture === "slide" ? <rect x={grip.x - r} y={grip.y - r} width={r * 2} height={r * 2} transform={`rotate(45 ${grip.x} ${grip.y})`} fill="#fffefa" stroke={grip.overlay.color} vectorEffect="non-scaling-stroke" />
            : <circle cx={grip.x} cy={grip.y} r={r} fill="#fffefa" stroke={grip.overlay.color} vectorEffect="non-scaling-stroke" />}
          {grip.handle.gesture === "rotate" ? <path d={`M ${grip.x - r * .5} ${grip.y + r * .15} A ${r * .5} ${r * .5} 0 1 1 ${grip.x + r * .15} ${grip.y + r * .5}`} fill="none" stroke={grip.overlay.color} vectorEffect="non-scaling-stroke" />
            : <circle cx={grip.x} cy={grip.y} r={r * .38} fill={grip.overlay.color} />}
          {/* A wider invisible target, so the grip is easy to catch. */}
          <circle className="inspection-grip-hit" cx={grip.x} cy={grip.y} r={r * 1.9} />
          {moving && shown && <text x={grip.x + r * 1.6} y={grip.y - r * 1.2} fontSize={text} fill={grip.overlay.color} className="inspection-label">{shown}</text>}
        </g>;
      })}
    </svg>
  </div>;
}
