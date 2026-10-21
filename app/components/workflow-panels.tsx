import type { ReactNode } from "react";
import type { SemanticPen } from "../lib/schema";
import { Icon } from "./icons";

// The right panel's head for each kind of frame in the workflow:
// sketch → Decompose (examples + pens) → draw with pens → Compose.

/** A minimal example made from a frame; `depth` > 0 for the smaller examples an example was decomposed into. */
export type ExampleRow = { id: string; name: string; depth: number; pen: SemanticPen | undefined; status: "pending" | "ready" | "error" | "empty" };
const statusLabel = { pending: "코드 생성 중", ready: "준비됨", error: "오류", empty: "코드 없음" } as const;

function PenChip({ pen, active, onUse }: { pen: SemanticPen; active: boolean; onUse: (pen: SemanticPen) => void }) {
  return <button type="button" className={`workflow-pen ${active ? "active" : ""}`} aria-pressed={active} title={pen.meaning} onClick={() => onUse(pen)}>
    <i style={{ background: pen.color }} />{pen.name}</button>;
}

/** The examples decomposed from a frame, and (indented) the smaller ones they were decomposed into. */
function ExampleList({ examples, onShowExample }: { examples: ExampleRow[]; onShowExample: (id: string) => void }) {
  return <ul className="workflow-examples">{examples.map(example => <li key={example.id} style={example.depth ? { paddingLeft: example.depth * 14 } : undefined}>
    <button type="button" title="최소 예제 프레임으로 이동" onClick={() => onShowExample(example.id)}>{example.depth > 0 && <span className="workflow-depth">└</span>}{example.pen && <i style={{ background: example.pen.color }} />}{example.name}</button>
    <small className={`status-${example.status}`}>{statusLabel[example.status]}</small></li>)}</ul>;
}

/** A sketch frame: the three steps, with the examples this sketch was decomposed into and every pen. */
export function SketchWorkflow({ examples, pens, activePenId, busy, canDecompose, onDecompose, onShowExample, onUsePen, compose }: {
  examples: ExampleRow[]; pens: SemanticPen[]; activePenId: string | null; busy: boolean; canDecompose: boolean;
  onDecompose: () => void; onShowExample: (id: string) => void; onUsePen: (pen: SemanticPen) => void; compose: ReactNode;
}) {
  return <section className="workflow-panel" aria-label="Workflow">
    <div className="workflow-step">
      <span className="workflow-step-number">1</span>
      <div><strong>Decompose</strong>
        <p>스케치를 서로 최대한 독립적인 semantic transformation으로 나눕니다. 각각은 그것만 보여주는 최소 예제 프레임이 되고, 그 예제가 transformation 펜이 됩니다.</p>
        <button className="primary-button" disabled={busy || !canDecompose} onClick={onDecompose}>{examples.length ? "Decompose again" : "Decompose sketch"}<Icon name="spark" size={15} /></button>
        {examples.length > 0 && <ExampleList examples={examples} onShowExample={onShowExample} />}
      </div>
    </div>
    <div className="workflow-step">
      <span className="workflow-step-number">2</span>
      <div><strong>Draw with pens</strong>
        <p>연필로 형태와 배치를 그리고, transformation 펜으로 그 transformation이 적용될 곳을 표시하세요. 펜은 최소 예제의 지금 상태를 따라갑니다.</p>
        {pens.length ? <div className="workflow-pens">{pens.map(pen => <PenChip key={pen.id} pen={pen} active={pen.id === activePenId} onUse={onUsePen} />)}</div>
          : <p className="workflow-muted">아직 펜이 없습니다. 먼저 Decompose하세요.</p>}
      </div>
    </div>
    <div className="workflow-step">
      <span className="workflow-step-number">3</span>
      <div className="workflow-compose">{compose}</div>
    </div>
  </section>;
}

/** A minimal example frame: which transformation it shows, the pen made from it, and the smaller examples it was decomposed into. */
export function ExampleHead({ transformation, subject, pen, activePenId, source, examples, busy, onUsePen, onSource, onDecompose, onShowExample }: {
  transformation: string; subject: string; pen: SemanticPen | undefined; activePenId: string | null; source: string | null;
  examples: ExampleRow[]; busy: boolean;
  onUsePen: (pen: SemanticPen) => void; onSource: () => void; onDecompose: () => void; onShowExample: (id: string) => void;
}) {
  return <section className="workflow-panel workflow-head" aria-label="Minimal example">
    <span className="section-kicker">MINIMAL EXAMPLE</span>
    <h3>{transformation}<small> · {subject}</small></h3>
    <p>이 transformation 하나만 보여주는 프레임입니다. 여기서 값을 조절하거나 transformation을 다시 만들면, 이 예제로 만든 펜이 그 상태를 그대로 가져갑니다.</p>
    <div className="workflow-pens">{pen ? <PenChip pen={pen} active={pen.id === activePenId} onUse={onUsePen} /> : <span className="workflow-muted">펜이 툴바에서 제거되었습니다.</span>}
      {source && <button type="button" className="workflow-link" onClick={onSource}><Icon name="arrow" size={12} />{source}</button>}</div>
    <div className="workflow-split">
      <p>이 transformation을 더 작은 transformation들로 다시 나눌 수 있습니다. 각각이 또 최소 예제 프레임과 펜이 됩니다. 이 예제와 펜은 그대로 남습니다.</p>
      <button className="alternative-button" disabled={busy} onClick={onDecompose}><Icon name="spark" size={13} />{examples.length ? "Decompose further again" : "Decompose further"}</button>
      {examples.length > 0 && <ExampleList examples={examples} onShowExample={onShowExample} />}
    </div>
  </section>;
}

/** A composition frame: the sketch and prompt it was composed from, and the examples whose transformations it took. */
export function CompositionHead({ source, prompt, origins, onSource, onOrigin }: {
  source: string | null; prompt: string; origins: { frameId: string; label: string; exists: boolean }[];
  onSource: () => void; onOrigin: (frameId: string) => void;
}) {
  return <section className="workflow-panel workflow-head" aria-label="Composition">
    <span className="section-kicker">COMPOSITION</span>
    {source && <button type="button" className="workflow-link" onClick={onSource}><Icon name="arrow" size={12} />{source}에서 Compose</button>}
    {origins.length > 0 && <div className="workflow-origins"><span>펜에서 가져온 transformation</span>
      {origins.map(origin => <button key={`${origin.frameId}:${origin.label}`} type="button" disabled={!origin.exists} title={origin.exists ? "최소 예제로 이동 (코드 생성 때 이 예제의 코드를 참고합니다)" : "예제 프레임이 삭제되었습니다"} onClick={() => onOrigin(origin.frameId)}>◆ {origin.label}</button>)}</div>}
    {prompt && <details><summary>Compose prompt</summary><p className="workflow-prompt">{prompt}</p></details>}
  </section>;
}
