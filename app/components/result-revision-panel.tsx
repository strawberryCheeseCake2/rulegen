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
      <p>결과 위에 원하는 형태나 수정할 부분을 자유롭게 스케치해주세요. AI가 스케치를 읽어 설명 초안을 만들고, 직접 수정할 수 있어요.</p>
      {!hasSketch && <div className="annotation-empty">결과 위를 드래그해 스케치를 시작하세요.</div>}
      <button className="primary-button" disabled={busy || !hasSketch} onClick={onClarify}>AI clarification 만들기<Icon name="spark" size={14} /></button>
    </> : <>
      {generatingClarification && <p role="status">AI가 스케치의 의도를 해석하고 있습니다…</p>}
      <label className="annotation-direction">TEXT CLARIFICATION<textarea ref={clarification} aria-label="Text clarification" rows={4} maxLength={2000} disabled={busy} value={instruction} onChange={e => onInstruction(e.target.value)} placeholder="AI가 만든 스케치 설명이 여기에 표시됩니다. 원하는 의도에 맞게 수정할 수 있어요." /></label>
      <p>AI 설명을 확인하거나 수정한 뒤 제안을 요청하세요. 이 설명을 바탕으로 기존 rule·visual feature 변경이나 새로운 항목 추가를 제안합니다.</p>
      {clarificationStale && <p className="revision-stale">스케치가 바뀌었습니다. AI 설명을 다시 만들거나 현재 설명을 직접 수정해주세요.</p>}
      <button className="copy-button" disabled={busy || !hasSketch} onClick={onRegenerateClarification}>AI 설명 다시 만들기<Icon name="spark" size={14} /></button>
      {!hasSketch && <p className="revision-stale">결과 위에 스케치를 추가한 뒤 변경안을 요청해주세요.</p>}
      <button className="primary-button" disabled={busy || !hasSketch || !instruction.trim()} onClick={onRequest}>{proposal ? "변경안 다시 요청" : "변경 제안 받기"}</button>
      <button className="copy-button" disabled={busy} onClick={onSketch}>스케치로 돌아가기</button>
      {proposal && <div className="revision-proposal" aria-label="Proposed collection and property changes">
        <strong>Rule · Visual feature 제안</strong><p>{proposal.summary}</p>
        {changes.map((c, i) => <div className="revision-change" key={i}><strong><span className={`revision-kind kind-${c.kind}`}>{c.kind === "add" ? "추가" : c.kind === "remove" ? "삭제" : "변경"}</span>{c.path}</strong><div><span>Before</span><pre>{c.before}</pre></div><div><span>After</span><pre>{c.after}</pre></div></div>)}
        {stale && <p role="alert" className="revision-stale">스케치·clarification 또는 현재 결과가 변경되었습니다. 변경안을 다시 요청해주세요.</p>}
        <button className="primary-button" disabled={busy || stale} onClick={onConfirm}>Confirm · 변경 적용</button>
        <button className="copy-button" disabled={busy} onClick={onDiscard}>제안 취소</button>
      </div>}
    </>}
  </section>;
}
