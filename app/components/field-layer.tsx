import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { combStroke, MAX_FIELD_STROKES, type FieldSamples, type FieldStroke } from "../lib/fields";

type Props = {
  /** The fields the inspected brush drew the held step with (by "<root>/<field id>"), sampled on a grid. */
  fields: [string, FieldSamples][];
  /** The what-if combs of each field, and changing them (the held step is drawn again with them). */
  edits: Record<string, FieldStroke[]>; onEdits: (edits: Record<string, FieldStroke[]>) => void;
  /** What a field is called (its brush's node and the field id). */
  nameOf: (key: string) => string;
  /** Why the inspection shows it (what the concern has to do with it). */
  whyOf?: (key: string) => string;
};
const COLORS = ["#2563eb", "#c2410c", "#0f766e", "#7c3aed"];

/**
 * The fields an inspected brush is driven by, drawn over the held step as arrows (direction, and strength as length),
 * and combed by hand: with Comb on, a drag pulls the field along it within the radius, and the brush is drawn again
 * with the field bent (a what-if on the held step; the frame does not change).
 */
export function FieldLayer({ fields, edits, onEdits, nameOf, whyOf }: Props) {
  const [shown, setShown] = useState(true), [combing, setCombing] = useState(false), [radius, setRadius] = useState(70), [strength, setStrength] = useState(1.2);
  const [picked, setPicked] = useState<string | null>(null);
  const key = picked && fields.some(([each]) => each === picked) ? picked : fields[0]?.[0] ?? null;
  const sheet = useRef<SVGSVGElement>(null), drag = useRef<{ pointer: number; points: { x: number; y: number }[]; sent: number } | null>(null);
  const [path, setPath] = useState<{ x: number; y: number }[] | null>(null);
  useEffect(() => { if (!fields.length) setCombing(false); }, [fields.length]);
  if (!fields.length || !key) return null;
  const point = (e: React.PointerEvent) => { const box = sheet.current!.getBoundingClientRect(); return { x: (e.clientX - box.left) / Math.max(1, box.width) * 900, y: (e.clientY - box.top) / Math.max(1, box.height) * 600 }; };
  /** The field's combs with the stroke being drawn (live, as the drag goes) or done. */
  const withStroke = (points: { x: number; y: number }[]) => { const stroke = combStroke(points, radius, strength); if (!stroke) return null;
    return { ...edits, [key]: [...(edits[key] ?? []), stroke].slice(-MAX_FIELD_STROKES) }; };
  const own = edits[key] ?? [], total = Object.values(edits).reduce((n, list) => n + list.length, 0);
  return <>
    <svg ref={sheet} className={`field-layer ${combing ? "combing" : ""}`} viewBox="0 0 900 600" preserveAspectRatio="none" aria-label="Field of the inspected brush"
      style={{ pointerEvents: combing ? "auto" : "none" }}
      onPointerDown={e => { if (!combing || e.button !== 0) return; e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); const at = point(e); drag.current = { pointer: e.pointerId, points: [at], sent: 0 }; setPath([at]); }}
      onPointerMove={e => { const current = drag.current; if (!current || current.pointer !== e.pointerId) return; e.preventDefault(); e.stopPropagation(); current.points.push(point(e)); setPath([...current.points]);
        // The brush follows the comb as it goes (at most every 80 ms).
        const now = performance.now(); if (now - current.sent > 80) { current.sent = now; const next = withStroke(current.points); if (next) onEdits(next); } }}
      onPointerUp={e => { const current = drag.current; if (!current || current.pointer !== e.pointerId) return; drag.current = null; setPath(null);
        const next = withStroke(current.points); if (next) onEdits(next); }}
      onPointerCancel={() => { drag.current = null; setPath(null); onEdits(edits); }}>
      {shown && fields.map(([each, field], n) => {
        const cw = field.w / field.cols, ch = field.h / field.rows, top = Math.max(1e-6, ...field.cells.map(cell => cell[1])), sx = 900 / field.w, sy = 600 / field.h, color = COLORS[n % COLORS.length];
        return <g key={each} className={`field-arrows ${each === key ? "picked" : ""}`} style={{ color }}>
          {field.cells.map(([angle, mag], i) => {
            const cx = ((i % field.cols) + .5) * cw * sx, cy = (Math.floor(i / field.cols) + .5) * ch * sy, length = Math.min(cw * sx, ch * sy) * .42 * (.35 + .65 * Math.min(1, mag / top));
            const dx = Math.cos(angle) * length, dy = Math.sin(angle) * length;
            return <g key={i}>
              <line x1={cx - dx} y1={cy - dy} x2={cx + dx} y2={cy + dy} vectorEffect="non-scaling-stroke" />
              <circle cx={cx + dx} cy={cy + dy} r={1.6} />
            </g>;
          })}
        </g>;
      })}
      {/* The combs: the band each one pulls within, and the one being drawn. */}
      {own.map((stroke, i) => <polyline key={i} className="field-comb" points={stroke.points.map(q => q.join(",")).join(" ")} strokeWidth={stroke.radius * 2} />)}
      {path && path.length > 1 && <polyline className="field-comb drawing" points={path.map(q => `${q.x},${q.y}`).join(" ")} strokeWidth={radius * 2} />}
    </svg>
    <div className="field-tools" onPointerDown={e => e.stopPropagation()}>
      <span className="section-kicker" title={whyOf?.(key) || undefined}>FIELD</span>
      {fields.length > 1 ? <select aria-label="Field to comb" value={key} onChange={e => setPicked(e.target.value)}>{fields.map(([each]) => <option key={each} value={each}>{nameOf(each)}</option>)}</select>
        : <b title={whyOf?.(key) || undefined}>{nameOf(key)}</b>}
      <button className={shown ? "active" : ""} aria-pressed={shown} title="Show the field as arrows" onClick={() => setShown(!shown)}>Arrows</button>
      <button className={combing ? "active" : ""} aria-pressed={combing} title="Drag over the picture to pull the field along your stroke (a what-if on this step)" onClick={() => setCombing(!combing)}><Icon name="pen" size={12} />Comb</button>
      {combing && <>
        <label>Radius<input type="range" min={15} max={220} step={5} value={radius} onChange={e => setRadius(e.currentTarget.valueAsNumber)} /><output>{radius}px</output></label>
        <label>Strength<input type="range" min={.2} max={4} step={.1} value={strength} onChange={e => setStrength(e.currentTarget.valueAsNumber)} /><output>×{strength.toFixed(1)}</output></label>
      </>}
      <button disabled={!own.length} title="Take back the last comb" onClick={() => onEdits({ ...edits, [key]: own.slice(0, -1) })}><Icon name="undo" size={12} /></button>
      <button disabled={!total} title="Back to the field as the code makes it" onClick={() => onEdits({})}>Reset</button>
      {total > 0 && <span className="field-note">{total} comb{total === 1 ? "" : "s"} · what-if on this step</span>}
      {(fields.find(([each]) => each === key)?.[1].declared ?? 1) > 1 && <span className="field-note field-warning" title="The code declares this field once per mark, so the arrows show only the last mark's field. Run Inspect again to hook it once.">Declared per mark · arrows may not match</span>}
    </div>
  </>;
}
