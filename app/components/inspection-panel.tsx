import { brushTool, type Brush, type BrushToolKind, type TargetedTool } from "../lib/brushes";
import { changedKeys, constraintRows, recommendationTransformations, formatScalar, MAX_STEPS, type InspectionFocus, type InspectionState, type InspectResult } from "../lib/inspection";
import { findNode } from "../lib/scene/graph";
import type { Scene } from "../lib/scene/schema";
import { useRef, useState } from "react";
import { Icon } from "./icons";

type Change = { key: string; stateId: string; value: number | string | boolean };
type Props = {
  brush: Brush; kind: BrushToolKind; scene: Scene; nodeIds: string[]; state: InspectionState; busy: boolean; running: boolean;
  /** The inspected frame (the active one) and every frame the brush is in, so another can be inspected. */
  frameId?: string; frames?: { id: string; name: string; master: boolean }[]; onFrame?: (frameId: string) => void;
  onCursor: (index: number | null) => void; onClear: () => void;
  /** The selected targeted inspection tool (kind "targeted"). */
  targeted?: TargetedTool;
  onFocus: (focus: InspectionFocus | null) => void; onConcern: (text: string) => void; onClearMarks: () => void;
  /** Inspection annotation: make a new targeted tool from the annotation and concern. Targeted: run its concern again. */
  onInspect: () => void;
  onApplyChanges: (changes: Change[]) => void; onApplyRecommendation: (recommendation: InspectResult["recommendations"][number]) => void;
  /** Switch to another tool of the group (a toolbar tool id). */
  onTool: (toolId: string) => void;
  /** Recommendations applied in this frame (newest last), undone ones to redo, and whether the frame is still as each left it. */
  applied?: { past: { id: string; title: string; key: string }[]; future: { id: string; title: string; key: string }[]; undoClean: boolean; redoClean: boolean };
  onUndoApplied?: () => void; onRedoApplied?: () => void;
  /** Inspection annotation: drawing (false) or erasing marks (true). */
  eraser?: boolean; onEraser?: (on: boolean) => void;
  /** Which recommendation an applied entry was (its key). */
  recommendationKey?: (item: InspectResult["recommendations"][number]) => string;
};

const sameFocus = (a: InspectionFocus | null, b: InspectionFocus) => Boolean(a && a.kind === b.kind && a.nodeId === b.nodeId && a.id === b.id);

type Step = InspectionState["steps"][number];
/** Where each step sits on the timeline (0..1): by time, but never closer than a minimum gap so every mark stays reachable. */
export function timelinePositions(steps: Pick<Step, "at">[]) {
  if (steps.length < 2) return steps.map(() => .5);
  const first = steps[0].at, span = Math.max(1, steps.at(-1)!.at - first), gap = 1 / (MAX_STEPS * 1.5);
  const raw = steps.map(item => (item.at - first) / span);
  for (let i = 1; i < raw.length; i++) raw[i] = Math.max(raw[i], raw[i - 1] + gap);
  const last = raw.at(-1)!;
  return raw.map(value => value / last);
}
const seconds = (ms: number) => `${ms < 0 ? "" : "+"}${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;

/**
 * Recorded steps as a timeline: hover a mark for its event, click or drag along
 * the track to move between steps (arrow keys, Home/End; Live follows the result).
 */
function StepTimeline({ steps, cursor, label, onCursor }: { steps: Step[]; cursor: number | null; label: (step: Step) => { event: string; detail: string }; onCursor: (index: number | null) => void }) {
  const track = useRef<HTMLDivElement>(null), scrubbing = useRef(false);
  const positions = timelinePositions(steps), at = (value: number) => `${3 + value * 94}%`;
  const nearest = (clientX: number) => {
    const box = track.current!.getBoundingClientRect(), x = ((clientX - box.left) / Math.max(1, box.width) - .03) / .94;
    return positions.reduce((best, value, i) => Math.abs(value - x) < Math.abs(positions[best] - x) ? i : best, 0);
  };
  const pick = (clientX: number) => { if (steps.length) { const index = nearest(clientX); if (index !== cursor) onCursor(index); } };
  const key = (e: React.KeyboardEvent) => {
    if (!steps.length) return;
    const index = cursor ?? steps.length;
    const next = e.key === "ArrowLeft" ? Math.max(0, index - 1) : e.key === "ArrowRight" ? (index + 1 >= steps.length ? null : index + 1) : e.key === "Home" ? 0 : e.key === "End" ? steps.length - 1 : e.key === "Escape" ? null : undefined;
    if (next === undefined) return;
    e.preventDefault(); onCursor(next);
  };
  return <div className="inspection-timeline">
    <div ref={track} className={`timeline-track ${steps.length ? "" : "empty"}`} role="slider" tabIndex={0} aria-label="Recorded steps timeline" aria-valuemin={1} aria-valuemax={Math.max(1, steps.length)}
      aria-valuenow={cursor === null ? steps.length : cursor + 1} aria-valuetext={cursor === null ? "Live" : `Step ${cursor + 1}: ${label(steps[cursor]).event}`}
      onKeyDown={key}
      onPointerDown={e => { if (!steps.length) return; scrubbing.current = true; e.currentTarget.setPointerCapture(e.pointerId); pick(e.clientX); }}
      onPointerMove={e => { if (scrubbing.current) pick(e.clientX); }}
      onPointerUp={() => { scrubbing.current = false; }} onPointerCancel={() => { scrubbing.current = false; }}>
      <span className="timeline-rail" />
      {cursor !== null && steps[cursor] && <span className="timeline-progress" style={{ width: at(positions[cursor]) }} />}
      {steps.map((item, i) => {
        const text = label(item);
        return <span key={item.id} className={`timeline-mark ${item.nodeId ? "transition" : "capture"} ${i === cursor ? "current" : ""}`} style={{ left: at(positions[i]) }} aria-label={`Step ${i + 1}: ${text.event}`}>
          <i />
          <span className="timeline-tip" role="tooltip"><b>{text.event}</b><span>{text.detail}</span><small>Step {i + 1} · {seconds(item.at - steps[0].at)}</small></span>
        </span>;
      })}
    </div>
    <div className="timeline-scale">{steps.length > 0 && <><span>0s</span><span>{seconds(steps.at(-1)!.at - steps[0].at)}</span></>}</div>
  </div>;
}

/**
 * Inspection of one brush: step through the recorded states and transitions
 * (up to MAX_STEPS) and see every constraint value change. With the inspection
 * annotation tool the user marks a concern, which becomes a new targeted
 * inspection tool (AI overlays, value fixes and recommendations).
 */
export function InspectionPanel(props: Props) {
  const { brush, scene, nodeIds, state, busy } = props;
  // Reset history asks once more, in place, before deleting the steps.
  const [confirmReset, setConfirmReset] = useState(false);
  // Undo/redo of an applied recommendation asks first when the frame changed since (those later edits go too).
  const [confirmStep, setConfirmStep] = useState<"undo" | "redo" | null>(null);
  const annotating = props.kind === "inspect-annotate", targeted = props.kind === "targeted" ? props.targeted : undefined;
  const frames = props.frames ?? [];
  if (!nodeIds.length) return <div className="inspection-empty"><Icon name="inspect" size={24} /><strong>이 프레임에는 {brush.name} brush가 없습니다.</strong>
    <span>{frames.length ? "검사할 프레임을 고르거나, Brush 도구로 이 프레임에 brush를 추가하세요." : "Brush 도구로 이 프레임에 brush를 추가하세요."}</span>
    {frames.length > 0 && <div className="inspection-frame-list">{frames.map(frame => <button key={frame.id} onClick={() => props.onFrame?.(frame.id)}>{frame.master ? "◆" : "◇"} {frame.name}<small>{frame.master ? "master" : "instance"}</small></button>)}</div>}</div>;
  const steps = state.steps, index = state.cursor ?? steps.length - 1, step = steps[index];
  const changed = changedKeys(steps, index), rows = constraintRows(scene, nodeIds);
  const node = (id: string | null) => id ? findNode(scene, id) : undefined;
  const stateLabel = (nodeId: string | null, id: string | null) => id ? node(nodeId)?.machine?.states.find(item => item.id === id)?.label || id : "—";
  const transition = step?.nodeId && step.transitionId ? node(step.nodeId)?.machine?.transitions.find(item => item.id === step.transitionId) : undefined;
  const focus = (item: InspectionFocus) => props.onFocus(sameFocus(state.focus, item) ? null : item);
  const stepTitle = (item: (typeof steps)[number]) => item.nodeId ? `${node(item.nodeId)?.name ?? item.nodeId}: ${stateLabel(item.nodeId, item.from)} → ${stateLabel(item.nodeId, item.to)}` : "Start";
  /** What a timeline mark says on hover: the transition (or capture) and the state change. */
  const stepLabel = (item: (typeof steps)[number]) => {
    const via = item.nodeId && item.transitionId ? node(item.nodeId)?.machine?.transitions.find(entry => entry.id === item.transitionId) : undefined;
    return item.nodeId ? { event: via?.label || via?.id || "시간/직접 이동", detail: stepTitle(item) } : { event: stepTitle(item), detail: "이 시점의 값" };
  };
  const result = targeted?.result ?? null;
  /** The node and part a recommendation changes, named as the user sees them. */
  const recommendationTargets = (item: InspectResult["recommendations"][number]): { node: string; label: string; focus: InspectionFocus }[] => {
    if (item.kind === "value") return item.changes.flatMap(change => {
      const row = rows.find(entry => entry.key === change.key); if (!row) return [];
      return [{ node: row.node, label: `${row.transformation ? `${row.transformation} · ` : ""}${row.property}${row.path ? ` › ${row.path}` : ""}`, focus: { kind: "constraint" as const, nodeId: row.binding.nodeId, id: row.binding.path[0] } }];
    }).filter((target, i, all) => all.findIndex(other => sameFocus(other.focus, target.focus)) === i);
    const target = node(item.nodeId);
    // A transformation fix may change several transformations: one chip each, each highlighting just its own card.
    if (item.kind === "transformation") return recommendationTransformations(item).map(id => ({ node: target?.name ?? item.nodeId, label: target?.transformations.find(entry => entry.id === id)?.label || id, focus: { kind: "transformation" as const, nodeId: item.nodeId, id } }));
    const label = item.kind === "state" ? target?.machine?.states.find(entry => entry.id === item.targetId)?.label : target?.machine?.transitions.find(entry => entry.id === item.targetId)?.label;
    return [{ node: target?.name ?? item.nodeId, label: label || item.targetId, focus: { kind: item.kind, nodeId: item.nodeId, id: item.targetId } }];
  };
  return <div className="inspection-body">
    <div className="inspection-toolbar">
      <span className="inspection-brush"><i style={{ background: brush.color }} />{brush.name}</span>
      {/* Which frame is inspected: any frame with this brush, master or instance. */}
      {frames.length > 0 && <select className="inspection-frame" aria-label="Inspected frame" title="Inspect this brush in another frame" value={props.frameId} onChange={e => props.onFrame?.(e.target.value)}>
        {frames.map(frame => <option key={frame.id} value={frame.id}>{frame.master ? "◆" : "◇"} {frame.name} · {frame.master ? "master" : "instance"}</option>)}</select>}
      <div className="inspection-modes" role="tablist" aria-label="Inspection tool">
        <button role="tab" aria-selected={props.kind === "inspect"} onClick={() => props.onTool(brushTool("inspect", brush.id))}><Icon name="inspect" size={12} />Inspection</button>
        <button role="tab" aria-selected={annotating} onClick={() => props.onTool(brushTool("inspect-annotate", brush.id))}><Icon name="inspect-pen" size={12} />Annotation</button>
        {brush.targeted.map(tool => <button key={tool.id} role="tab" aria-selected={targeted?.id === tool.id} title={tool.concern} onClick={() => props.onTool(brushTool("targeted", brush.id, tool.id))}><Icon name="target" size={12} />{tool.name}</button>)}
      </div>
      <span className="inspection-stepper">
        <button aria-label="Previous step" disabled={!steps.length || index <= 0} onClick={() => props.onCursor(Math.max(0, index - 1))}>◀</button>
        <output>{steps.length ? `${index + 1} / ${steps.length}` : `0 / ${MAX_STEPS}`}</output>
        <button aria-label="Next step" disabled={!steps.length || index >= steps.length - 1} onClick={() => props.onCursor(Math.min(steps.length - 1, index + 1))}>▶</button>
        <button className={state.cursor === null ? "live" : ""} title="Follow the running result" onClick={() => props.onCursor(null)}>Live</button>
      </span>
      {confirmReset && steps.length ? <span className="inspection-reset-confirm" role="group" aria-label="Confirm reset">
          {steps.length}개 단계를 지울까요?
          <button className="danger" onClick={() => { setConfirmReset(false); props.onClear(); }}>Reset</button>
          <button onClick={() => setConfirmReset(false)}>Cancel</button>
        </span>
        : <button title={`Delete this brush's recorded history in this frame (${steps.length} steps) and follow the result live`} disabled={!steps.length} onClick={() => setConfirmReset(true)}><Icon name="trash" size={12} />Reset history</button>}
    </div>
    <StepTimeline steps={steps} cursor={state.cursor} label={stepLabel} onCursor={props.onCursor} />
    {!steps.length && <div className="inspection-timeline-hint"><span className="inspection-hint">{props.running ? `결과가 상태를 바꿀 때마다 자동으로 기록됩니다 (최대 ${MAX_STEPS}개). Brush 도구로 이 프레임의 brush를 움직여 보세요.` : "이 프레임의 결과를 먼저 생성해주세요."}</span></div>}
    <div className="inspection-content">
      <section className="inspection-side">
        {step && <div className="inspection-step-detail">
          <span className="section-kicker">STEP {index + 1}{state.cursor === null ? " · LIVE" : ""}</span>
          {step.nodeId ? <>
            <strong>{node(step.nodeId)?.name}</strong>
            <div className="inspection-chips">
              <button className={sameFocus(state.focus, { kind: "state", nodeId: step.nodeId, id: step.from || "" }) ? "focused" : ""} disabled={!step.from} onClick={() => step.from && focus({ kind: "state", nodeId: step.nodeId!, id: step.from })}>{stateLabel(step.nodeId, step.from)}</button>
              <span>→</span>
              <button className={sameFocus(state.focus, { kind: "state", nodeId: step.nodeId, id: step.to || "" }) ? "focused" : ""} onClick={() => step.to && focus({ kind: "state", nodeId: step.nodeId!, id: step.to })}>{stateLabel(step.nodeId, step.to)}</button>
            </div>
            {transition ? <button className={`inspection-transition ${sameFocus(state.focus, { kind: "transition", nodeId: step.nodeId, id: transition.id }) ? "focused" : ""}`} onClick={() => focus({ kind: "transition", nodeId: step.nodeId!, id: transition.id })}>
              <Icon name="arrow" size={12} />{transition.label}<small>{transition.trigger === "after" ? `${transition.afterMs}ms 후` : "event"}</small></button>
              : <small className="inspection-muted">전이 없이 이동 (재시작 또는 직접 이동)</small>}
          </> : <span className="inspection-muted">{stepTitle(step)} · 이 시점의 값을 기록했습니다.</span>}
          <span className="inspection-muted">{changed.size ? `${[...changed].filter(key => !key.includes("/@")).length}개 constraint 값이 이전 단계와 다릅니다.` : index > 0 ? "이전 단계와 값이 같습니다." : ""}</span>
        </div>}
        {annotating && <form className="inspection-concern" onSubmit={e => { e.preventDefault(); props.onInspect(); }}>
          <span className="section-kicker">INSPECTION ANNOTATION</span>
          <span className="inspection-muted">프레임에 보라색으로 알고 싶은 곳을 표시하고(동그라미·메모) concern을 적으면, 그 concern 전용 Targeted inspection 도구가 이 brush 그룹에 생깁니다.</span>
          {props.onEraser && <div className="inspection-draw-mode" role="radiogroup" aria-label="Inspection annotation mode">
            <button type="button" role="radio" aria-checked={!props.eraser} className={!props.eraser ? "active" : ""} onClick={() => props.onEraser!(false)}><Icon name="inspect-pen" size={12} />Pen</button>
            <button type="button" role="radio" aria-checked={Boolean(props.eraser)} className={props.eraser ? "active" : ""} title="Drag over marks on the frame to erase them (E)" onClick={() => props.onEraser!(true)}><Icon name="eraser" size={12} />Eraser</button>
            {props.eraser && <span className="inspection-muted">프레임에서 지울 자국 위를 문지르세요.</span>}</div>}
          <div className="inspection-chips">
            {state.marks.length > 0 ? <span className="machine-attachment machine-attachment-annotation inspection-mark-chip"><Icon name="inspect-pen" size={12} /><b>Inspection annotation</b>{state.marks.length}획 첨부됨
              <button type="button" aria-label="Clear inspection annotation" onClick={props.onClearMarks}><Icon name="close" size={11} /></button></span>
              : <span className="inspection-muted">아직 annotation이 없습니다.</span>}
          </div>
          <textarea aria-label="Concern" rows={2} maxLength={2000} value={state.concern} placeholder="예: 별 크기가 단계마다 어떻게 바뀌는지 알고 싶어" onChange={e => props.onConcern(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); props.onInspect(); } }} />
          <button type="submit" className="primary" disabled={busy || !(state.concern.trim() || state.marks.length)}><Icon name="target" size={13} />{busy ? "Creating…" : "Create targeted inspection"}</button>
        </form>}
        {targeted && <div className="inspection-concern">
          <span className="section-kicker">TARGETED INSPECTION</span>
          <strong>{targeted.name}</strong>
          {targeted.concern && <span className="inspection-muted">{targeted.concern}</span>}
          <button type="button" className="inspection-apply-all" disabled={busy} title="Build this inspection again from the current steps" onClick={props.onInspect}><Icon name="target" size={12} />{busy ? "Inspecting…" : "Inspect again"}</button>
        </div>}
        {result && <div className="inspection-result">
          <p>{result.summary}</p>
          {result.overlays.length > 0 && <div className="inspection-legend">{result.overlays.map(overlay => <button key={overlay.id} className={sameFocus(state.focus, overlay.link) ? "focused" : ""} onClick={() => focus(overlay.link)}>
            <i style={{ background: overlay.color }} />{overlay.name || overlay.label.replace(/\$\{[^}]*\}/g, "…").trim() || overlay.id}</button>)}</div>}
          {result.valueFixes.length > 0 && <div className="inspection-fixes"><span className="section-kicker">VALUE FIX</span>
            {result.valueFixes.map((fix, i) => <div key={i} className="inspection-fix"><code>{rows.find(row => row.key === fix.key)?.property || fix.key}{fix.stateId ? ` · ${fix.stateId}` : ""} = {String(fix.value)}</code><span>{fix.reason}</span>
              <button disabled={busy} onClick={() => props.onApplyChanges([fix])}>Apply</button></div>)}
            {result.valueFixes.length > 1 && <button className="inspection-apply-all" disabled={busy} onClick={() => props.onApplyChanges(result.valueFixes)}>Apply all values</button>}
          </div>}
          {result.recommendations.length > 0 && <div className="inspection-recommendations"><div className="inspection-applied-bar"><span className="section-kicker">RECOMMENDATIONS</span>
            {/* Undo / redo a whole applied recommendation: scene, code and prompt together. */}
            {props.applied && (props.applied.past.length > 0 || props.applied.future.length > 0) && (confirmStep ? <span className="inspection-reset-confirm" role="group" aria-label="Confirm undo">
                적용 뒤에 바꾼 내용도 함께 {confirmStep === "undo" ? "되돌아갑니다" : "덮어씁니다"}.
                <button className="danger" onClick={() => { const step = confirmStep; setConfirmStep(null); (step === "undo" ? props.onUndoApplied : props.onRedoApplied)?.(); }}>{confirmStep === "undo" ? "Undo" : "Redo"}</button>
                <button onClick={() => setConfirmStep(null)}>Cancel</button></span>
              : <span className="inspection-applied-actions">
                <button disabled={busy || !props.applied.past.length} title={props.applied.past.length ? `Undo 「${props.applied.past.at(-1)!.title}」 (scene and code)` : "Nothing applied"}
                  onClick={() => props.applied!.undoClean ? props.onUndoApplied?.() : setConfirmStep("undo")}><Icon name="undo" size={12} />Undo apply</button>
                <button disabled={busy || !props.applied.future.length} title={props.applied.future.length ? `Redo 「${props.applied.future.at(-1)!.title}」` : "Nothing to redo"}
                  onClick={() => props.applied!.redoClean ? props.onRedoApplied?.() : setConfirmStep("redo")}><Icon name="redo" size={12} />Redo</button></span>)}</div>
            {result.recommendations.map((item, i) => <div key={i} className={`inspection-recommendation ${props.recommendationKey && props.applied?.past.some(entry => entry.key === props.recommendationKey!(item)) ? "applied" : ""}`}><b><em>{item.kind === "value" ? "값" : item.kind === "transformation" ? "Transformation" : item.kind === "state" ? "State" : "Transition"}</em>{item.title}</b>
              {/* What it changes: click to highlight it (the transformation card, the property, or the state/transition in the graph). */}
              <div className="inspection-targets">{recommendationTargets(item).map(target => <button key={`${target.focus.kind}:${target.focus.nodeId}:${target.focus.id}`} className={`inspection-target ${sameFocus(state.focus, target.focus) ? "focused" : ""}`}
                aria-pressed={sameFocus(state.focus, target.focus)} title="Highlight what this changes" onClick={() => focus(target.focus)}><Icon name="target" size={11} /><span>{target.node}</span><b>{target.label}</b></button>)}</div>
              <span>{item.detail}</span>
              <button disabled={busy} onClick={() => props.onApplyRecommendation(item)}>{item.kind === "value" ? "Apply values" : "Apply with AI"}</button>
              {props.recommendationKey && props.applied?.past.some(entry => entry.key === props.recommendationKey!(item)) && <small className="inspection-applied-mark">✓ 적용됨 · Undo apply로 되돌릴 수 있습니다</small>}</div>)}
          </div>}
        </div>}
      </section>
      <section className="inspection-table" aria-label="Constraint values">
        <table><thead><tr><th>Constraint</th><th>Value</th><th>Δ</th><th>Steps</th></tr></thead><tbody>
          {rows.map(row => {
            const value = step?.values[row.key], previous = steps[index - 1]?.values[row.key];
            const delta = typeof value === "number" && typeof previous === "number" && value !== previous ? value - previous : null;
            const numbers = steps.map(item => item.values[row.key]).filter((item): item is number => typeof item === "number");
            const low = Math.min(...numbers), high = Math.max(...numbers);
            const item: InspectionFocus = { kind: "constraint", nodeId: row.binding.nodeId, id: row.binding.path[0] };
            return <tr key={row.key} className={`${changed.has(row.key) ? "changed" : ""} ${sameFocus(state.focus, item) ? "focused" : ""}`} onClick={() => focus(item)}>
              <td><span className="inspection-node">{row.node}</span><span>{row.transformation && `${row.transformation} · `}<b>{row.property}</b>{row.path && ` › ${row.path}`}</span></td>
              <td className="inspection-value">{row.binding.type === "color" && typeof value === "string" ? <i className="inspection-color" style={{ background: value }} /> : null}{formatScalar(value)}</td>
              <td className="inspection-delta">{delta !== null ? `${delta > 0 ? "+" : ""}${formatScalar(delta)}` : changed.has(row.key) ? "changed" : ""}</td>
              <td className="inspection-trace">{steps.map((item, i) => { const v = item.values[row.key];
                const height = typeof v === "number" && high > low ? 3 + (v - low) / (high - low) * 13 : 8;
                return <i key={item.id} className={i === index ? "current" : ""} title={`${i + 1}: ${formatScalar(v)}`} style={{ height, background: row.binding.type === "color" && typeof v === "string" ? v : undefined }} />; })}</td>
            </tr>;
          })}
          {!rows.length && <tr><td colSpan={4} className="inspection-muted">이 brush에는 조절할 constraint 값이 없습니다.</td></tr>}
        </tbody></table>
      </section>
    </div>
  </div>;
}
