import { useRef, useState } from "react";
import { bounds, extend, hitStroke, newStroke, pivot, placedPoints, type ManipStroke, type Point } from "../lib/execution/strokes";
import { asks, type ManipTool } from "../lib/execution/manipulate";
import type { LayerTool, ManipView, TargetRow } from "../studio/use-manipulation";

// Direct manipulation on the Execution frame: the strokes the user shows a concern with (on the picture), and below
// the frame the rule question, the tools, and the execution variables the strokes set (recorded → shown → after).

const COLOR = "#2b6cd4";
const TOOL_LABEL: Record<ManipTool, string> = { brush: "Brush", pencil: "Pencil", select: "Select · scale · rotate" };

type Drag = { kind: "draw"; stroke: ManipStroke } | { kind: "move" | "scale" | "rotate"; start: ManipStroke; from: Point; center: Point };

/** The strokes over the picture; drawn, selected, moved, scaled and rotated with the tool chosen. */
export function ManipLayer({ strokes, tool, selected, onAdd, onChange, onSelect, probes = [], onProbe, hidden = false }: {
  strokes: ManipStroke[]; tool: LayerTool | null; selected: string | null;
  onAdd: (stroke: ManipStroke) => void; onChange: (stroke: ManipStroke) => void; onSelect: (id: string | null) => void;
  /** Spots clicked with the inspect tool (shown as crosshairs). */ probes?: Point[]; onProbe?: (at: Point) => void;
  /** The brush / pencil marks are hidden (what they show still applies); one being drawn shows while it is drawn. */ hidden?: boolean;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const at = (event: React.PointerEvent): Point => {
    const box = layer.current!.getBoundingClientRect();
    return { x: (event.clientX - box.left) / box.width * 900, y: (event.clientY - box.top) / box.height * 600 };
  };
  if (!tool && !strokes.length && !probes.length) return null;
  const shown = [...(hidden ? [] : strokes), ...(drag?.kind === "draw" ? [drag.stroke] : [])];
  const picked = tool === "select" && !hidden ? strokes.find(stroke => stroke.id === selected) : undefined;
  const box = picked ? bounds(placedPoints(picked)) : null;
  const centerOf = (stroke: ManipStroke) => { const c = pivot(stroke); return { x: c.x + stroke.dx, y: c.y + stroke.dy }; };

  const down = (event: React.PointerEvent) => {
    if (!tool || event.button !== 0) return;
    event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    const p = at(event), handle = (event.target as Element).getAttribute("data-handle");
    if (tool === "inspect") { onProbe?.(p); return; }
    if (tool !== "select") { setDrag({ kind: "draw", stroke: newStroke(`m${Date.now().toString(36)}`, tool, p) }); return; }
    if (picked && (handle === "scale" || handle === "rotate")) { setDrag({ kind: handle, start: picked, from: p, center: centerOf(picked) }); return; }
    const hit = hitStroke(strokes, p), stroke = strokes.find(item => item.id === hit);
    onSelect(hit);
    if (stroke) setDrag({ kind: "move", start: stroke, from: p, center: centerOf(stroke) });
  };
  const move = (event: React.PointerEvent) => {
    if (!drag) return;
    event.stopPropagation();
    const p = at(event);
    if (drag.kind === "draw") { const next = extend(drag.stroke, p); if (next !== drag.stroke) setDrag({ ...drag, stroke: next }); return; }
    const { start, from, center } = drag;
    if (drag.kind === "move") onChange({ ...start, dx: start.dx + p.x - from.x, dy: start.dy + p.y - from.y });
    else if (drag.kind === "scale") {
      const ratio = Math.hypot(p.x - center.x, p.y - center.y) / Math.max(1, Math.hypot(from.x - center.x, from.y - center.y));
      onChange({ ...start, scale: Math.min(12, Math.max(.08, start.scale * ratio)) });
    } else onChange({ ...start, rotate: start.rotate + Math.atan2(p.y - center.y, p.x - center.x) - Math.atan2(from.y - center.y, from.x - center.x) });
  };
  const up = (event: React.PointerEvent) => {
    if (!drag) return;
    event.stopPropagation();
    if (drag.kind === "draw" && drag.stroke.points.length > 1) onAdd(drag.stroke);
    setDrag(null);
  };
  return <div ref={layer} className={`manip-layer ${tool ? `tool-${tool}` : ""}`} aria-label="Direct manipulation" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}>
    <svg viewBox="0 0 900 600" preserveAspectRatio="none">
      {shown.map(stroke => <polyline key={stroke.id} points={placedPoints(stroke).map(p => `${p.x},${p.y}`).join(" ")} stroke={COLOR}
        strokeWidth={stroke.width * stroke.scale} strokeOpacity={stroke.tool === "brush" ? .45 : .95} className={stroke.id === selected && tool === "select" ? "picked" : ""} />)}
      {probes.map((p, i) => <g key={`probe-${i}`} className="manip-probe"><circle cx={p.x} cy={p.y} r={9} /><line x1={p.x - 14} y1={p.y} x2={p.x + 14} y2={p.y} /><line x1={p.x} y1={p.y - 14} x2={p.x} y2={p.y + 14} /></g>)}
      {box && <g className="manip-selection">
        <rect x={box.x - 6} y={box.y - 6} width={box.w + 12} height={box.h + 12} />
        <line x1={box.x + box.w / 2} y1={box.y - 6} x2={box.x + box.w / 2} y2={box.y - 30} />
        <circle data-handle="rotate" cx={box.x + box.w / 2} cy={box.y - 34} r={8}><title>Rotate</title></circle>
        <rect data-handle="scale" x={box.x + box.w} y={box.y + box.h} width={14} height={14}><title>Scale</title></rect>
      </g>}
    </svg>
  </div>;
}

/** Below the Execution frame: the rule question, the tools, and what the strokes set. */
export function ManipPanel({ view, rows, onBegin, onChoose, onRechoose, onTool, onClearProbes, onRemove, onClear, onToggleMarks, onApply, onRetry, onTryFork, onKeepFork, onDiscardFork, onShowFork, onShowOriginal, forkError = "", onRegenerate, onGeneralize, generalizing = false }: {
  view: ManipView; rows: TargetRow[];
  onBegin: () => void; onChoose: (ruleId: string) => void; onRechoose: () => void; onTool: (tool: LayerTool) => void; onClearProbes?: () => void;
  onRemove: () => void; onClear: () => void; onToggleMarks?: () => void; onApply: () => void; onRetry: () => void;
  onTryFork: () => void; onKeepFork: () => void; onDiscardFork: () => void; onShowFork: () => void; onShowOriginal?: () => void;
  /** The fork's code failed while running. */ forkError?: string;
  onRegenerate?: (what: "rules" | "tools" | "live" | "overlay", failed?: string) => void;
  /** Fork mode: make what was shown the original brush's own rule (the rules it could be are asked first). */ onGeneralize?: () => void;
  /** Its rules are being asked or shown (below this panel). */ generalizing?: boolean;
}) {
  const forkMode = view.mode === "fork";
  // What failed and can be made again, each with its own button.
  const failedPreviews = Object.values(view.thumbnails).some(item => item.note && !item.src);
  const problems: { key: string; text: string; label: string; run: () => void }[] = !onRegenerate ? [] : [
    ...(forkError ? [{ key: "live", text: `The fork's code failed: ${forkError}`, label: "Regenerate the fork's code", run: () => onRegenerate("live", forkError) }] : []),
    ...(view.clarify && rows.some(row => row.error) ? [{ key: "tools", text: "A tool's measurement failed.", label: "Regenerate the tools", run: () => onRegenerate("tools") }] : []),
    ...(forkMode && view.clarify && (view.forkInspect === "failed" || Object.keys(view.overlayErrors).length > 0)
      ? [{ key: "overlay", text: Object.values(view.overlayErrors)[0] ?? "The values could not be shown on the fork.", label: "Regenerate the overlay", run: () => onRegenerate("overlay") }] : []),
  ];
  const asked = !view.choice && asks(view.asked) ? view.asked : null, clarify = view.clarify, idle = !view.asked && !clarify;
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const fold = (id: string) => setFolded(current => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next; });
  return <div className="manip-panel" onPointerDown={event => event.stopPropagation()}>
    <header>
      <span className="section-kicker">SHOW IT</span>
      <p>{view.direct ? <>Changed on the fork to meet the concern, without tools: <b>{view.concern}</b></> : clarify?.summary ?? view.asked?.summary ?? "Show what you mean on the picture with tools made for this concern."}</p>
      {view.busy && <span className="manip-busy"><span className="loading-spinner" />{view.status}</span>}
      {!view.busy && view.status && <span className="manip-status">{view.status} {(!idle || forkMode) && <button type="button" onClick={onRetry}>Retry</button>}</span>}
      {idle && !view.busy && !forkMode && <button type="button" className="exec-button primary manip-begin" onClick={onBegin}>Make tools to show it</button>}
    </header>
    {asked && <section className="manip-question">
      <strong>{asked.question}</strong>
      {asked.reason && <small>{asked.reason}</small>}
      {failedPreviews && onRegenerate && <p className="manip-problem">Some previews could not be drawn.<button type="button" disabled={view.busy} onClick={() => onRegenerate("rules")}>Regenerate the options</button></p>}
      <div className="manip-options">{asked.rules.map(rule => <button type="button" key={rule.id} disabled={view.busy} onClick={() => onChoose(rule.id)}>
        <div className="manip-thumb">
          <img src={view.picture} alt="" className="manip-thumb-picture" />
          {view.thumbnails[rule.id]?.src && <img src={view.thumbnails[rule.id].src} alt="" />}
          {!view.thumbnails[rule.id] && rule.thumbnail && <em className="manip-thumb-note">Drawing the preview…</em>}
          {view.thumbnails[rule.id]?.note && <em className="manip-thumb-note">{view.thumbnails[rule.id].note}</em>}
          <span className={`manip-thumb-rule ${folded.has(rule.id) ? "folded" : ""}`}>
            <span className="manip-thumb-head"><b>{rule.rule}</b>
              <span role="button" tabIndex={0} className="manip-fold" title={folded.has(rule.id) ? "Show the rule" : "Minimize to see the picture"} aria-label={folded.has(rule.id) ? "Show the rule" : "Minimize"}
                onClick={event => { event.stopPropagation(); fold(rule.id); }} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); fold(rule.id); } }}>{folded.has(rule.id) ? "+" : "–"}</span></span>
            {rule.logic && !folded.has(rule.id) && <code>{rule.logic}</code>}
          </span>
        </div>
        <small>{rule.detail}</small>
        <span className="manip-rule-tools">{rule.tools.map(tool => <i key={tool.kind}>{TOOL_LABEL[tool.kind]}</i>)}</span>
      </button>)}</div>
    </section>}
    {view.choice && <p className="manip-choice">Rule: <b>{view.choice.rule}</b> <code>{view.choice.logic}</code>{view.asked && <button type="button" disabled={view.busy} onClick={onRechoose}>Pick another</button>}</p>}
    {clarify && <section className="manip-tools">
      {clarify.tools.map(tool => <button type="button" key={tool.kind} aria-pressed={view.tool === tool.kind} onClick={() => onTool(tool.kind)}>
        <b>{TOOL_LABEL[tool.kind]}</b><small>{tool.purpose}</small></button>)}
      <div className="manip-stroke-actions">
        <button type="button" disabled={!view.selected} onClick={onRemove}>Delete stroke</button>
        <button type="button" disabled={!view.strokes.length} onClick={onClear}>Clear</button>
        {onToggleMarks && clarify.tools.some(tool => tool.kind !== "select") && <button type="button" aria-pressed={Boolean(view.marksHidden)} disabled={!view.strokes.length} onClick={onToggleMarks}
          title="Hide or show the brush / pencil marks on the picture (what they show still applies)">{view.marksHidden ? "Show marks" : "Hide marks"}</button>}
      </div>
    </section>}
    {clarify && forkMode && <section className="manip-tools manip-inspect">
      <button type="button" aria-pressed={view.tool === "inspect"} onClick={() => onTool("inspect")}>
        <b>Inspect</b><small>Click spots on the fork to see their execution values (click a spot again to remove it).</small></button>
      <div className="manip-stroke-actions">
        <button type="button" disabled={!view.probes.length} onClick={onClearProbes}>Clear spots</button>
      </div>
      {view.probes.length > 0 && !view.forkAnalysis && <p className="manip-note">{view.forkInspect === "busy" ? "Finding the values the tools set…"
        : view.live !== "ready" ? "The values show once the fork follows the rule." : "The values show once the fork has drawn from what you showed: paint first."}</p>}
    </section>}
    {problems.map(problem => <p key={problem.key} className="manip-problem">{problem.text}<button type="button" disabled={view.busy} onClick={problem.run}>{problem.label}</button></p>)}
    {clarify && rows.length > 0 && <table className="manip-targets">
      <thead><tr><th>Variable</th><th>{forkMode ? "Original" : "Recorded"}</th><th>Shown</th><th>{view.fork ? "On the fork" : "After change"}</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id} title={row.meaning}>
        <td><b>{row.name}</b><small>{row.where}{row.param ? " · param" : ""}</small></td>
        <td>{row.before}</td>
        <td>{row.error ? <em>{row.error}</em> : row.shown}{row.applied && <small>set on the param</small>}</td>
        <td>{row.after || "—"}</td>
      </tr>)}</tbody>
    </table>}
    {clarify && !clarify.targets.length && <p className="manip-note">{clarify.related ? "" : "Nothing in the code is about this yet: "}what you show goes to the change as it is.</p>}
    {view.direct && forkMode && view.fork && view.live === "ready" && <footer>
      <span className="manip-fork-note">⑂ A temporary fork of <button type="button" className="manip-link" onClick={onShowOriginal}>the original</button>, which stays as it is.</span>
      <button type="button" className="exec-button" disabled={view.busy} onClick={onDiscardFork}>Discard the fork</button>
      <button type="button" className="exec-button primary" disabled={view.busy} onClick={onKeepFork} title="The original becomes the fork, with its brush updated">Keep: change the original</button>
    </footer>}
    {clarify && <footer>
      {forkMode ? <>
        <span className="manip-fork-note">⑂ A temporary fork of <button type="button" className="manip-link" onClick={onShowOriginal}>the original</button>, which stays as it is.</span>
        <button type="button" className="exec-button" disabled={view.busy} onClick={onDiscardFork}>Discard the fork</button>
        {onGeneralize && <button type="button" className="exec-button" aria-pressed={generalizing} disabled={view.busy || view.live !== "ready" || !view.strokes.length} onClick={onGeneralize}
          title="Make what you showed the original brush's own behavior, everywhere it draws: pick the rule it means (with previews), then its constraints, states and code change">Make it the brush's rule…</button>}
        <button type="button" className="exec-button primary" disabled={view.busy || !view.strokes.length} onClick={onKeepFork} title="The original becomes the fork (what you showed written into its code), with its brush updated">Keep: change the original</button>
      </> : view.fork ? <>
        <span className="manip-fork-note">⑂ Tried on a <button type="button" className="manip-link" onClick={onShowFork}>temporary fork</button>; the original is unchanged.</span>
        <button type="button" className="exec-button" disabled={view.busy || !view.strokes.length} onClick={onTryFork}>Try again on the fork</button>
        <button type="button" className="exec-button" disabled={view.busy} onClick={onDiscardFork}>Discard the fork</button>
        <button type="button" className="exec-button primary" disabled={view.busy} onClick={onKeepFork}>Keep: change the original</button>
      </> : <>
        <button type="button" className="exec-button" disabled={view.busy || !view.strokes.length} onClick={onTryFork} title="Copy this frame and its result, and try the change there; the original stays as it is">Try on a temporary fork</button>
        <button type="button" className="exec-button primary" disabled={view.busy || !view.strokes.length} onClick={onApply}>Change the brush from this</button>
      </>}
    </footer>}
  </div>;
}
