import { useMemo, useRef, useState } from "react";
import type { FrameExport } from "../lib/frame-export";
import { downloadFile } from "../lib/project";
import { Icon } from "./icons";

/** One frame as JSON (state machines, params, code): preview, copy and download. */
export function FrameJsonDialog({ name, data, onClose, onCopied }: { name: string; data: FrameExport; onClose: () => void; onCopied: (message: string) => void }) {
  const text = useMemo(() => JSON.stringify(data, null, 2), [data]);
  const area = useRef<HTMLTextAreaElement>(null), [note, setNote] = useState("");
  const machines = data.nodes.filter(node => !node.machine.implicit), states = machines.reduce((n, node) => n + node.machine.states.length, 0);
  const constraints = data.nodes.reduce((n, node) => n + node.constraints.length, 0), params = data.nodes.reduce((n, node) => n + Object.keys(node.values).length, 0);
  const tools = data.brushes.reduce((n, brush) => n + brush.targetedInspections.length, 0);
  async function copy() {
    try { await navigator.clipboard.writeText(text); onCopied(`Copied the JSON of ${name}.`); onClose(); }
    // The clipboard can be refused (permissions, an unfocused page): the text is selected to copy by hand.
    catch { area.current?.focus(); area.current?.select(); setNote("Automatic copy was blocked. Copy the selected content with ⌘C / Ctrl+C."); }
  }
  return <div className="modal-backdrop" onClick={onClose}><div className="modal project-export-modal frame-json-modal" role="dialog" aria-modal="true" aria-labelledby="frame-json-title" onClick={e => e.stopPropagation()}>
    <button className="modal-close" aria-label="Close frame JSON" onClick={onClose}><Icon name="close" /></button>
    <div className="section-kicker">FRAME JSON</div><h2 id="frame-json-title">{name}</h2>
    <p>{data.nodes.length} nodes · {machines.length} state machine{machines.length === 1 ? "" : "s"} ({states} state{states === 1 ? "" : "s"}) · {constraints} constraints · {params} param values · {data.algorithms.length} algorithms · {tools} targeted inspections · code: {data.code ? `${data.code.source.split("\n").length} lines` : "none"}.
      Each node includes its constraints (the property each controls, with its params, value ranges and algorithm blocks), its param values, and its FSM: every state's constraints in evaluation order and the event transitions; each brush includes its targeted inspection tools (concern, annotation, summary, overlays, hidden parameters, item records) keyed by this frame's node ids. The code matches the code panel.</p>
    <textarea ref={area} aria-label="Frame JSON" className="project-json-preview" readOnly value={text} />
    {note && <p className="frame-json-note" role="status">{note}</p>}
    <div className="frame-json-actions">
      <button className="primary-button" onClick={() => { void copy(); }}>Copy JSON<Icon name="copy" /></button>
      <button className="copy-button" onClick={() => downloadFile(`${name}.frame.json`, text, "application/json")}>Download<Icon name="download" size={14} /></button>
    </div>
  </div></div>;
}
