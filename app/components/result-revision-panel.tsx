import { useEffect, useRef } from "react";
import { Icon } from "./icons";
import type { SceneChange, SceneProposal } from "../lib/scene/revisions";

export function ResultRevisionPanel({ hasSketch, clarifying, generatingClarification, clarificationStale, instruction, proposal, changes, stale, busy, tool, canUndo, canRedo, onTool, onUndo, onRedo, onClarify, onRegenerateClarification, onSketch, onInstruction, onRequest, onConfirm, onDiscard, onClose }: {
  hasSketch: boolean; clarifying: boolean; instruction: string; proposal: SceneProposal | null; changes: SceneChange[]; stale: boolean; busy: boolean;
  tool: string; canUndo: boolean; canRedo: boolean; onTool: (tool: string) => void; onUndo: () => void; onRedo: () => void;
  generatingClarification: boolean; clarificationStale: boolean; onRegenerateClarification: () => void;
  onClarify: () => void; onSketch: () => void; onInstruction: (text: string) => void; onRequest: () => void; onConfirm: () => void; onDiscard: () => void; onClose: () => void;
}) {
  const clarification = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (clarifying && !busy) clarification.current?.focus(); }, [clarifying, busy]);
  return <section className="result-revision-panel" aria-label="Result annotation revision">
    <div className="revision-panel-heading"><strong>{clarifying ? "Clarify your sketch" : "Sketch on result"}</strong><button onClick={onClose} disabled={busy}>Done</button></div>
    <p className="feedback-flow">Sketch → AI clarification → Suggestions → Confirm</p>
    <div className="annotation-tools" role="toolbar" aria-label="Result annotation tools">
      <button aria-label="Draw result annotations" aria-pressed={tool === "pen"} disabled={busy} onClick={() => onTool("pen")}><Icon name="pen" size={14} />Draw</button>
      <button aria-label="Erase result annotations" aria-pressed={tool === "eraser"} disabled={busy} onClick={() => onTool("eraser")}><Icon name="eraser" size={14} />Erase</button>
      <button aria-label="Undo result annotations" disabled={busy || !canUndo} onClick={onUndo}><Icon name="undo" size={14} /></button>
      <button aria-label="Redo result annotations" disabled={busy || !canRedo} onClick={onRedo}><Icon name="redo" size={14} /></button>
    </div>
    {!clarifying ? <>
      <p>Freely sketch the shape you want or the parts to change on top of the result. The AI reads the sketch and drafts a description, which you can edit.</p>
      {!hasSketch && <div className="annotation-empty">Drag over the result to start sketching.</div>}
      <button className="primary-button" disabled={busy || !hasSketch} onClick={onClarify}>Generate AI clarification<Icon name="spark" size={14} /></button>
    </> : <>
      {generatingClarification && <p role="status">The AI is interpreting the intent of your sketch…</p>}
      <label className="annotation-direction">TEXT CLARIFICATION<textarea ref={clarification} aria-label="Text clarification" rows={4} maxLength={2000} disabled={busy} value={instruction} onChange={e => onInstruction(e.target.value)} placeholder="The AI's description of your sketch appears here. You can edit it to match your intent." /></label>
      <p>Review or edit the AI description, then request a proposal. Based on it, changes to existing rules or visual features, or new additions, will be proposed.</p>
      {clarificationStale && <p className="revision-stale">The sketch changed. Regenerate the AI description or edit the current one yourself.</p>}
      <button className="copy-button" disabled={busy || !hasSketch} onClick={onRegenerateClarification}>Regenerate AI description<Icon name="spark" size={14} /></button>
      {!hasSketch && <p className="revision-stale">Add a sketch on top of the result, then request changes.</p>}
      <button className="primary-button" disabled={busy || !hasSketch || !instruction.trim()} onClick={onRequest}>{proposal ? "Request changes again" : "Get change proposal"}</button>
      <button className="copy-button" disabled={busy} onClick={onSketch}>Back to sketch</button>
      {proposal && <div className="revision-proposal" aria-label="Proposed collection and property changes">
        <strong>Rule · Visual feature proposal</strong><p>{proposal.summary}</p>
        {changes.map((c, i) => <div className="revision-change" key={i}><strong><span className={`revision-kind kind-${c.kind}`}>{c.kind === "add" ? "Add" : c.kind === "remove" ? "Remove" : "Change"}</span>{c.path}</strong><div><span>Before</span><pre>{c.before}</pre></div><div><span>After</span><pre>{c.after}</pre></div></div>)}
        {stale && <p role="alert" className="revision-stale">The sketch, clarification, or current result changed. Request changes again.</p>}
        <button className="primary-button" disabled={busy || stale} onClick={onConfirm}>Confirm · Apply changes</button>
        <button className="copy-button" disabled={busy} onClick={onDiscard}>Discard proposal</button>
      </div>}
    </>}
  </section>;
}
