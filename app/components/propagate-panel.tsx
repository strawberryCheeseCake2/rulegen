import { useState } from "react";
import { valueText, type PartChanges } from "../lib/scene/propagation";

// Under a part frame of a decomposition that was changed on its own: what changed, and whether to pass it up to the
// frames it came from (each can be left out) or keep it in this part only.

const MAX_ROWS = 6;

export function PropagatePanel({ changes, ancestors, tools, busy, onPropagate, onKeep, onShow }: {
  changes: PartChanges; ancestors: { id: string; name: string }[]; tools: string[]; busy: boolean;
  onPropagate: (targets: string[]) => void; onKeep: () => void; onShow: (id: string) => void;
}) {
  const [left, setLeft] = useState<Set<string>>(new Set());
  const targets = ancestors.filter(item => !left.has(item.id)).map(item => item.id);
  const rewrites = changes.code || changes.structure || changes.tools.length > 0;
  const toggle = (id: string) => setLeft(current => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next; });
  return <div className="propagate-panel" onPointerDown={event => event.stopPropagation()}>
    <header><span className="section-kicker">PROPAGATE</span><strong>This part changed. Pass it up to the frames it came from?</strong></header>
    <ul className="propagate-changes">
      {changes.params.slice(0, MAX_ROWS).map(item => <li key={`${item.nodeId}/${item.constraintId}/${item.paramId}`}><span>{item.label}</span><b>{valueText(item.before)} → {valueText(item.after)}</b></li>)}
      {changes.params.length > MAX_ROWS && <li><span>…and {changes.params.length - MAX_ROWS} more values</span></li>}
      {changes.structure && <li><span>Constraints</span><b>added, removed or redescribed</b></li>}
      {changes.code && <li><span>Code</span><b>computes differently</b></li>}
      {tools.map(name => <li key={name}><span>Inspection tools</span><b>{name}</b></li>)}
    </ul>
    <div className="propagate-targets" role="group" aria-label="Frames to pass it up to">
      {ancestors.map((item, k) => <label key={item.id}><input type="checkbox" checked={!left.has(item.id)} disabled={busy} onChange={() => toggle(item.id)} />
        <span>{"↑".repeat(k + 1)} </span><button type="button" className="manip-link" onClick={() => onShow(item.id)}>{item.name}</button></label>)}
    </div>
    <p className="propagate-note">{rewrites ? "Values and constraints the frames above share are set as they are; their code is rewritten (AI) to compute this part the same way." : "Only values changed: they are set in the frames above as they are (no AI)."}</p>
    <footer>
      <button type="button" className="exec-button" disabled={busy} onClick={onKeep} title="Keep the change in this part only (not asked again for it)">Keep here only</button>
      <button type="button" className="exec-button primary" disabled={busy || !targets.length} onClick={() => onPropagate(targets)}>{busy ? "Propagating…" : `Propagate to ${targets.length === ancestors.length ? (ancestors.length > 1 ? "all above" : "the frame above") : `${targets.length} frame${targets.length === 1 ? "" : "s"}`}`}</button>
    </footer>
  </div>;
}
