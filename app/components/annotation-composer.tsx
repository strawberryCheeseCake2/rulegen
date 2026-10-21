import type { Clarification, SemanticPen } from "../lib/schema";
import type { TransformDraft } from "../lib/sketch-panels";
import { Icon } from "./icons";

export type DraftPatch = Partial<Pick<TransformDraft, "instruction" | "annotating" | "marks" | "markPens" | "answer">>;

/**
 * Add or modify a transformation with AI: text and an annotation drawn on the frame. The AI first answers in
 * text (what it understood, what it will add or change where, the plan, its questions); nothing changes until
 * Apply. Answering (or editing the request) and asking again refines it.
 */
export function AnnotationComposer({ draft, kind, what, busy, describe, pen, onChange, onClarify, onApply, onCancel }: {
  draft: TransformDraft; kind: string; what: string; busy: boolean;
  /** A toolbar pen by id (to show the pens the annotation was drawn with). */
  pen?: (id: string) => SemanticPen | undefined;
  /** What a clarification will change, in words. */
  describe: (clarification: Clarification) => string;
  onChange: (patch: DraftPatch) => void; onClarify: () => void; onApply: () => void; onCancel: () => void;
}) {
  const clarification = draft.clarification, empty = !draft.instruction.trim() && !draft.marks.length;
  const plain = draft.marks.filter((_, i) => !draft.markPens[i]).length;
  const pens = [...new Set(draft.markPens.filter(Boolean))].map(id => ({ id, pen: pen?.(id), strokes: draft.markPens.filter(item => item === id).length }));
  const placeholder = draft.nodeId === null ? "프레임에 그려서 짚고, 무엇을 더하거나 바꿀지 적어주세요. 예: 이 점들을 더 크게 휘게"
    : draft.target.transformationId || draft.target.propertyId ? "어떻게 바꿀지 적어주세요. 예: 가지가 위로 갈수록 더 가늘어지게" : "어떤 transformation을 더할지 적어주세요. 예: 바람에 흔들리게";
  return <form className="regenerate-composer" aria-label="Add or modify with AI" onSubmit={e => { e.preventDefault(); if (clarification) onApply(); else onClarify(); }}>
    <span className="section-kicker">{draft.nodeId === null ? "ANNOTATE FRAME" : "ADD OR MODIFY WITH AI"}</span>
    <div className="inspection-chips"><span className="machine-attachment"><Icon name="spark" size={12} /><b>{kind}</b>{what}</span></div>
    <textarea aria-label="What to add or change" maxLength={2000} rows={3} autoFocus={draft.nodeId !== null} placeholder={placeholder}
      value={draft.instruction} onChange={e => onChange({ instruction: e.target.value })} />
    <div className="regenerate-annotation">
      {draft.marks.length > 0 ? <span className="machine-attachment machine-attachment-annotation"><Icon name="pen" size={12} /><b>Annotation</b>{plain > 0 && `${plain}획`}
        {pens.map(item => <span key={item.id} className="annotation-pen" style={{ color: item.pen?.color }} title={item.pen?.meaning}><i style={{ background: item.pen?.color }} />{item.pen?.name ?? "지워진 펜"} {item.strokes}획</span>)} 첨부됨
        <button type="button" aria-label="Clear annotation" onClick={() => onChange({ marks: [], markPens: [] })}><Icon name="close" size={11} /></button></span>
        : <span className="inspection-muted">프레임에 그려서 더하거나 바꿀 곳을 짚어줄 수 있어요. 툴바의 transformation 펜으로 그리면 그 펜의 transformation을 거기에 쓰라는 뜻이 됩니다.</span>}
      <button type="button" className={draft.annotating ? "active" : ""} aria-pressed={draft.annotating} onClick={() => onChange({ annotating: !draft.annotating })}>
        <Icon name="pen" size={12} />{draft.annotating ? "Done drawing" : "Draw on frame"}</button>
    </div>
    {clarification && <section className="clarification" aria-label="AI clarification">
      <span className="section-kicker">AI가 이해한 내용</span>
      {clarification.understanding && <p>{clarification.understanding}</p>}
      <p className="clarification-target"><b>{clarification.action === "add" ? "추가" : "수정"}</b>{describe(clarification)}</p>
      {clarification.plan && <p className="clarification-plan">{clarification.plan}</p>}
      {clarification.questions.length > 0 && <>
        <ul className="clarification-questions">{clarification.questions.map((question, i) => <li key={i}>{question}</li>)}</ul>
        <textarea aria-label="Answer the questions" maxLength={1000} rows={2} placeholder="답하거나 고칠 점을 적고 Clarify again을 누르세요. 그대로 Apply해도 됩니다."
          value={draft.answer} onChange={e => onChange({ answer: e.target.value })} />
      </>}
    </section>}
    <div className="regenerate-actions">
      {clarification
        ? <><button type="submit" className="primary" disabled={busy}><Icon name="spark" size={12} />{busy ? "Applying…" : "Apply"}</button>
          <button type="button" disabled={busy} onClick={onClarify}>Clarify again</button></>
        : <button type="submit" className="primary" disabled={busy || (draft.nodeId === null && empty)}><Icon name="spark" size={12} />{busy ? "Clarifying…" : "Clarify"}</button>}
      <button type="button" onClick={onCancel}>Cancel</button>
    </div>
  </form>;
}
