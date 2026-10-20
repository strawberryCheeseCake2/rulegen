import { useId } from "react";
import { ART_HEIGHT as H, ART_WIDTH as W } from "../lib/schema";
import { historyOverlays, layoutLabels, markStyleAt, type InspectionFocus, type InspectionState, type InspectResult, type MarkStyle, type Scalar } from "../lib/inspection";

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
};

const same = (a: InspectionFocus | null, b: InspectionFocus) => Boolean(a && a.kind === b.kind && a.nodeId === b.nodeId && a.id === b.id);

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

export function InspectionOverlay({ state, marks, markStyles, result, drawn, liveValues, clickable, zoom, onFocus, onStep, stepName }: Props) {
  const step = state.cursor !== null ? state.steps[state.cursor] : undefined;
  // The step being looked at (the latest while following the result): overlays are recomputed from its values and stores; the other steps show as ghosts.
  const index = state.cursor ?? state.steps.length - 1;
  const placed = result ? historyOverlays(result.overlays, state.steps, index, liveValues, drawn) : [];
  const text = 12 / Math.max(.2, zoom);
  const uid = useId().replace(/:/g, ""), badge = 7 / Math.max(.2, zoom);
  // One number per step and overlay (an overlay drawn per item numbers its first item only), and the path through those spots in step order.
  const marked = placed.filter(item => item.key.endsWith(":0"));
  const badges = marked.map(item => {
    const right = Math.max(item.x, item.x + item.w), top = Math.min(item.y, item.y + item.h);
    const spot = item.overlay.kind === "line" ? { x: item.x + item.w, y: item.y + item.h } : item.overlay.kind === "label" ? { x: item.x - badge * 1.6, y: item.y - badge } : { x: right, y: top };
    return { key: `badge:${item.key}`, ...spot, at: item.step, ghost: item.ghost, color: item.overlay.color };
  });
  const paths = (result?.overlays ?? []).filter(overlay => !overlay.each).map(overlay => ({ overlay, points: marked.filter(item => item.overlay.id === overlay.id).sort((a, b) => a.step - b.step)
    .map(item => item.overlay.kind === "line" || item.overlay.kind === "label" ? { x: item.x, y: item.y } : { x: item.x + item.w / 2, y: item.y + item.h / 2 }) }))
    .filter(path => path.points.length > 1 && path.points.some(point => Math.hypot(point.x - path.points[0].x, point.y - path.points[0].y) > 2));
  const current = placed.filter(item => !item.ghost), byKey = new Map(current.map(item => [item.key, item]));
  const counts = new Map<string, number>();
  const labels = layoutLabels(current.filter(item => item.label && (counts.set(item.overlay.id, (counts.get(item.overlay.id) ?? 0) + 1).get(item.overlay.id)! <= LABELS_PER_OVERLAY)).map(item => ({
    key: item.key, text: item.label, shape: item.overlay.kind === "label" ? { x: item.x, y: item.y, w: 0, h: 0 } : { x: item.x, y: item.y, w: item.w, h: item.h },
    anchor: item.overlay.kind === "line" ? { x: item.x + item.w, y: item.y + item.h } : item.overlay.kind === "label" ? { x: item.x, y: item.y } : { x: Math.min(item.x, item.x + item.w), y: Math.min(item.y, item.y + item.h) - 4 },
  })), text, { width: W, height: H }, badges.map(item => ({ x: item.x - badge, y: item.y - badge, width: badge * 2, height: badge * 2 })));
  return <div className="inspection-overlay" aria-label="Inspection overlay">
    {step && <span className="inspection-step-badge">Step {state.cursor! + 1} / {state.steps.length}</span>}
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
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
      {badges.map(({ key, x, y, at, ghost, color }) => {
        const go = Boolean(ghost && clickable && onStep);
        return <g key={key} className={`inspection-badge ${ghost ? "ghost" : "current"} ${go ? "clickable" : ""}`} opacity={ghost ? Math.max(.35, .8 - (Math.abs(ghost) - 1) * .08) : 1}
          onPointerDown={e => { if (!go) return; e.preventDefault(); e.stopPropagation(); onStep!(at); }}>
          {go && <title>{`Step ${at + 1}${stepName ? ` · ${stepName(at)}` : ""}`}</title>}
          <circle cx={x} cy={y} r={badge} fill={ghost ? "#fffefa" : color} stroke={color} vectorEffect="non-scaling-stroke" />
          <text x={x} y={y} fontSize={badge * 1.25} fill={ghost ? color : "#fff"} textAnchor="middle" dominantBaseline="central">{at + 1}</text>
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
    </svg>
  </div>;
}
