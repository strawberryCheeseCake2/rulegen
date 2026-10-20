import { brushTool, type Brush, type BrushToolKind, type TargetedTool } from "../lib/brushes";
import { changedKeys, concernCompletion, constraintRows, currentRecommendation, recommendationTransformations, formatScalar, MARK_COLORS, MAX_STEPS, type InspectionFocus, type InspectionState, type MarkStyle, type Recommendation } from "../lib/inspection";
import { findNode } from "../lib/scene/graph";
import type { ScalarValue, Scene } from "../lib/scene/schema";
import { parameterStatus, recordingApplied, type ParameterSuggestion, type Recording } from "../lib/hidden-parameters";
import { findProperty } from "../lib/scene/transformations";
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
  onApplyChanges: (changes: Change[]) => void; /** Apply a recommendation as it reads now (an added transformation is that transformation); `index` in the list, `listed` as stored. */
  onApplyRecommendation: (recommendation: Recommendation, index: number, listed: Recommendation) => void;
  /** Switch to another tool of the group (a toolbar tool id). */
  onTool: (toolId: string) => void;
  /** Hidden parameters the targeted inspection suggests (by index in its list): accept exposes it, reject (or bring back) marks it; an accepted one is adjusted here. */
  onAcceptParameter?: (item: ParameterSuggestion, index: number) => void; onRejectParameter?: (index: number, rejected: boolean) => void;
  onParameterValue?: (nodeId: string, propertyId: string, value: ScalarValue["value"]) => void;
  /** The frame's program, and applying the result's item records again (it is applied with the result; Undo apply may take it back). */
  code?: string; onApplyRecording?: (item: Recording) => void;
  /** Recommendations applied in this frame (newest last), undone ones to redo, and whether the frame is still as each left it. */
  applied?: { past: { id: string; title: string; key: string }[]; future: { id: string; title: string; key: string }[]; undoClean: boolean; redoClean: boolean };
  onUndoApplied?: () => void; onRedoApplied?: () => void;
  /** Inspection annotation: drawing (false) or erasing marks (true). */
  eraser?: boolean; onEraser?: (on: boolean) => void;
  /** The pen the next marks are drawn with. */
  pen?: MarkStyle; onPen?: (pen: MarkStyle) => void;
  /** Autocomplete: concerns AI suggested from the inspection annotation (and the typed start), asked with onSuggest; the first that continues the text is shown as its completion (Tab). */
  suggestions?: { items: string[]; loading: boolean; error: string }; onSuggest?: () => void;
  /** Which recommendation an applied entry was (its key). */
  recommendationKey?: (item: Recommendation) => string;
};

/**
 * Constants the code hard-codes that the concern depends on, suggested as new
 * properties. Pending: accept (exposes it, no regeneration) or reject. Accepted:
 * a control right here to try values. Rejected: folded, can be brought back.
 */
function HiddenParameters({ items, scene, busy, onAccept, onReject, onValue }: { items: (ParameterSuggestion & { rejected?: boolean })[]; scene: Scene; busy: boolean;
  onAccept?: Props["onAcceptParameter"]; onReject?: Props["onRejectParameter"]; onValue?: Props["onParameterValue"] }) {
  const range = (value: ScalarValue) => value.type === "number" ? `${formatScalar(value.value)}${value.unit} (${formatScalar(value.min)}–${formatScalar(value.max)})` : value.type === "toggle" ? (value.value ? "켜짐" : "꺼짐") : String(value.value);
  return <div className="inspection-parameters"><span className="section-kicker">HIDDEN PARAMETERS</span>
    <span className="inspection-muted">코드에 고정된 값 중 이 concern에 관련된 것입니다. Accept하면 property로 추가되어 바로 조절할 수 있습니다(코드 재생성 없음).</span>
    {items.map((item, i) => {
      const status = parameterStatus(item, scene), node = findNode(scene, item.nodeId), transformation = node?.transformations.find(entry => entry.id === item.transformationId);
      const property = node ? findProperty(node, item.id) : undefined, value = property && property.value.type !== "algorithm" ? property.value : null;
      return <div key={`${item.nodeId}:${item.id}`} className={`inspection-parameter ${status}`}>
        <b><em>{status === "accepted" ? "추가됨" : status === "rejected" ? "거절됨" : "제안"}</em>{item.label}<span>{node?.name ?? item.nodeId} · {transformation?.label ?? item.transformationId}</span></b>
        {status !== "rejected" && <span>{item.reason}</span>}
        {status === "pending" && <>
          <code>지금 코드의 값 {range(item.value)}</code>
          <div className="inspection-parameter-actions">
            <button type="button" className="accept" disabled={busy || !onAccept} onClick={() => onAccept?.(item, i)}><Icon name="plus" size={11} />Accept</button>
            <button type="button" disabled={busy || !onReject} onClick={() => onReject?.(i, true)}>Reject</button>
          </div>
          <details><summary>코드 변경 보기</summary>{item.edits.map((edit, k) => <pre key={k}><del>{edit.find}</del>{"\n"}<ins>{edit.replace}</ins></pre>)}</details>
        </>}
        {status === "accepted" && value && <ParameterControl label={item.label} value={value} disabled={!onValue} onChange={next => onValue?.(item.nodeId, item.id, next)} />}
        {status === "accepted" && <small className="inspection-applied-mark">✓ property로 추가됨 · Undo apply로 되돌릴 수 있습니다</small>}
        {status === "rejected" && onReject && <button type="button" className="inspection-parameter-restore" onClick={() => onReject(i, false)}>다시 보기</button>}
      </div>;
    })}
  </div>;
}
/** Per-item fields the inspection made the code record, so its overlays can show them on each item. */
function ItemRecords({ item, applied, busy, onApply }: { item: Recording; applied: boolean; busy: boolean; onApply?: Props["onApplyRecording"] }) {
  return <div className={`inspection-records ${applied ? "applied" : ""}`}><span className="section-kicker">ITEM RECORDS</span>
    <span>{applied ? `✓ 그려진 항목마다 ${item.fields.join(", ")}을(를) 기록합니다. overlay가 항목별 값을 보여줍니다.` : `항목별 ${item.fields.join(", ")} 기록이 지금 코드에 없습니다. overlay의 항목별 값이 나오지 않습니다.`}</span>
    {item.reason && <span className="inspection-muted">{item.reason}</span>}
    {!applied && onApply && <button type="button" disabled={busy} onClick={() => onApply(item)}>기록 추가</button>}
    <details><summary>코드 변경 보기</summary>{item.edits.map((edit, k) => <pre key={k}><del>{edit.find}</del>{"\n"}<ins>{edit.replace}</ins></pre>)}</details>
  </div>;
}
/** A control for one scalar (number slider, color, toggle, select). */
function ParameterControl({ label, value, disabled, onChange }: { label: string; value: ScalarValue; disabled: boolean; onChange: (value: ScalarValue["value"]) => void }) {
  if (value.type === "number") return <label className="inspection-parameter-control"><input type="range" aria-label={label} min={value.min} max={value.max} step={value.step} value={value.value} disabled={disabled} onChange={e => onChange(Number(e.target.value))} /><output>{formatScalar(value.value)}{value.unit}</output></label>;
  if (value.type === "color") return <label className="inspection-parameter-control"><input type="color" aria-label={label} value={value.value} disabled={disabled} onChange={e => onChange(e.target.value)} /><output>{value.value}</output></label>;
  if (value.type === "toggle") return <label className="inspection-parameter-control"><input type="checkbox" aria-label={label} checked={value.value} disabled={disabled} onChange={e => onChange(e.target.checked)} /><output>{value.value ? "켜짐" : "꺼짐"}</output></label>;
  return <label className="inspection-parameter-control"><select aria-label={label} value={value.value} disabled={disabled} onChange={e => onChange(e.target.value)}>{value.options.map(option => <option key={option}>{option}</option>)}</select></label>;
}

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

/** Color, width and opacity of the inspection annotation pen, with a preview of the stroke. */
function MarkPen({ pen, onPen }: { pen: MarkStyle; onPen: (pen: MarkStyle) => void }) {
  return <div className="inspection-pen" role="group" aria-label="Inspection annotation pen">
    <div className="inspection-pen-colors">
      {MARK_COLORS.map(color => <button key={color} type="button" aria-label={`Pen color ${color}`} aria-pressed={pen.color.toLowerCase() === color} className={pen.color.toLowerCase() === color ? "active" : ""} style={{ background: color }} onClick={() => onPen({ ...pen, color })} />)}
      <label className="inspection-pen-custom" title="Other color"><input type="color" aria-label="Pen color" value={pen.color} onChange={e => onPen({ ...pen, color: e.target.value })} /></label>
      <svg className="inspection-pen-preview" viewBox="0 0 60 24" aria-hidden="true"><path d="M4 16C16 4 26 22 38 10S52 8 56 12" style={{ stroke: pen.color, strokeWidth: Math.min(16, pen.width * .8), opacity: pen.opacity }} /></svg>
    </div>
    <label><span>굵기</span><input type="range" aria-label="Pen width" min={1} max={30} step={1} value={pen.width} onChange={e => onPen({ ...pen, width: e.currentTarget.valueAsNumber })} /><b>{pen.width}px</b></label>
    <label><span>투명도</span><input type="range" aria-label="Pen opacity" min={10} max={100} step={5} value={Math.round(pen.opacity * 100)} onChange={e => onPen({ ...pen, opacity: e.currentTarget.valueAsNumber / 100 })} /><b>{Math.round(pen.opacity * 100)}%</b></label>
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
  const recommendationTargets = (item: Recommendation): { node: string; label: string; focus: InspectionFocus }[] => {
    if (item.kind === "value") return item.changes.flatMap(change => {
      const row = rows.find(entry => entry.key === change.key); if (!row) return [];
      return [{ node: row.node, label: `${row.transformation ? `${row.transformation} · ` : ""}${row.property}${row.path ? ` › ${row.path}` : ""}`, focus: { kind: "constraint" as const, nodeId: row.binding.nodeId, id: row.binding.path[0] } }];
    }).filter((target, i, all) => all.findIndex(other => sameFocus(other.focus, target.focus)) === i);
    const target = node(item.nodeId);
    // A transformation fix may change several transformations: one chip each, each highlighting just its own card.
    // A new transformation: the chip names the node it goes on (clicking selects that node).
    if (item.kind === "add-transformation") return [{ node: target?.name ?? item.nodeId, label: "+ 새 transformation", focus: { kind: "transformation" as const, nodeId: item.nodeId, id: "" } }];
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
          <span className="inspection-muted">프레임에 알고 싶은 곳을 표시하고(동그라미·메모) concern을 적으면, 그 concern 전용 Targeted inspection 도구가 이 brush 그룹에 생깁니다.</span>
          {props.onEraser && <div className="inspection-draw-mode" role="radiogroup" aria-label="Inspection annotation mode">
            <button type="button" role="radio" aria-checked={!props.eraser} className={!props.eraser ? "active" : ""} onClick={() => props.onEraser!(false)}><Icon name="inspect-pen" size={12} />Pen</button>
            <button type="button" role="radio" aria-checked={Boolean(props.eraser)} className={props.eraser ? "active" : ""} title="Drag over marks on the frame to erase them (E)" onClick={() => props.onEraser!(true)}><Icon name="eraser" size={12} />Eraser</button>
            {props.eraser && <span className="inspection-muted">프레임에서 지울 자국 위를 문지르세요.</span>}</div>}
          {props.pen && props.onPen && !props.eraser && <MarkPen pen={props.pen} onPen={props.onPen} />}
          <div className="inspection-chips">
            {state.marks.length > 0 ? <span className="machine-attachment machine-attachment-annotation inspection-mark-chip"><Icon name="inspect-pen" size={12} /><b>Inspection annotation</b>{state.marks.length}획 첨부됨
              <button type="button" aria-label="Clear inspection annotation" onClick={props.onClearMarks}><Icon name="close" size={11} /></button></span>
              : <span className="inspection-muted">아직 annotation이 없습니다.</span>}
          </div>
          {(() => {
            // The typed text, then (in grey) how the best suggestion completes it; Tab takes it.
            const items = props.suggestions?.items ?? [], completion = items.map(item => concernCompletion(state.concern, item)).find(Boolean) ?? "";
            const placeholder = !state.concern && items[0] ? items[0] : "예: 별 크기가 단계마다 어떻게 바뀌는지 알고 싶어";
            return <>
              <div className="concern-input">
                <div className="concern-ghost" aria-hidden="true"><span className="concern-typed">{state.concern}</span><span className="concern-rest">{completion}</span></div>
                <textarea aria-label="Concern" rows={2} maxLength={2000} value={state.concern} placeholder={placeholder} onChange={e => props.onConcern(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Tab" && !e.shiftKey && (completion || (!state.concern && items[0]))) { e.preventDefault(); props.onConcern(completion ? state.concern + completion : items[0]); return; }
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); props.onInspect(); }
                  }} />
              </div>
              {props.suggestions && props.onSuggest && <div className="concern-suggestions" aria-label="Suggested concerns">
                <span className="concern-suggestions-head">
                  <button type="button" className="concern-autocomplete" disabled={busy || props.suggestions.loading || !(state.marks.length || state.concern.trim())} title="AI reads the inspection annotation (and what you typed) and suggests concerns" onClick={props.onSuggest}>
                    <Icon name="spark" size={11} />{props.suggestions.loading ? "Autocompleting…" : "Autocomplete"}</button>
                  {!props.suggestions.loading && (items.length ? (completion || (!state.concern && items[0])) && <span><kbd>Tab</kbd> 으로 넣기</span> : props.suggestions.error && <span>{props.suggestions.error}</span>)}</span>
                {items.map(item => <button type="button" key={item} className={`concern-suggestion ${item === state.concern ? "chosen" : ""}`} onClick={() => props.onConcern(item)}>{item}</button>)}
              </div>}
            </>;
          })()}
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
          {result.records && <ItemRecords item={result.records} applied={recordingApplied(scene, props.code ?? "", result.records)} busy={busy} onApply={props.onApplyRecording} />}
          {result.parameters.length > 0 && <HiddenParameters items={result.parameters} scene={scene} busy={busy} onAccept={props.onAcceptParameter} onReject={props.onRejectParameter} onValue={props.onParameterValue} />}
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
            {result.recommendations.map((listed, i) => {
              // A new transformation it already added reads as that transformation (back to "new" if it is undone).
              const item = currentRecommendation(listed, scene), added = item !== listed, applied = props.recommendationKey && props.applied?.past.some(entry => entry.key === props.recommendationKey!(listed));
              return <div key={i} className={`inspection-recommendation ${applied ? "applied" : ""} ${added ? "added" : ""}`}><b><em>{item.kind === "value" ? "값" : item.kind === "transformation" ? (added ? "Transformation · 추가됨" : "Transformation") : item.kind === "add-transformation" ? "새 Transformation" : item.kind === "state" ? "State" : "Transition"}</em>{item.title}</b>
              {/* What it changes: click to highlight it (the transformation card, the property, or the state/transition in the graph). */}
              <div className="inspection-targets">{recommendationTargets(item).map(target => <button key={`${target.focus.kind}:${target.focus.nodeId}:${target.focus.id}`} className={`inspection-target ${sameFocus(state.focus, target.focus) ? "focused" : ""}`}
                aria-pressed={sameFocus(state.focus, target.focus)} title="Highlight what this changes" onClick={() => focus(target.focus)}><Icon name="target" size={11} /><span>{target.node}</span><b>{target.label}</b></button>)}</div>
              <span>{item.detail}</span>
              <button disabled={busy} title={added ? "Refine the transformation this recommendation added" : undefined} onClick={() => props.onApplyRecommendation(item, i, listed)}>{item.kind === "value" ? "Apply values" : item.kind === "add-transformation" ? "Add with AI" : "Apply with AI"}</button>
              {applied && <small className="inspection-applied-mark">✓ 적용됨{added ? " · 위 transformation으로 추가되었습니다" : ""} · Undo apply로 되돌릴 수 있습니다</small>}</div>;
            })}
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
