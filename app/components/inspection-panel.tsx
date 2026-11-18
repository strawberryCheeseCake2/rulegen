import { brushTool, type Brush, type BrushToolKind, type TargetedTool } from "../lib/brushes";
import { INPUT_KEY, isRuntimeKey } from "../lib/runtime-edits";
import { changedKeys, concernCompletion, paramRows, formatScalar, MARK_COLORS, MAX_STEPS, sameFocus, stepValues, type InspectionFocus, type InspectionState, type MarkStyle } from "../lib/inspection";
import { findNode } from "../lib/scene/graph";
import { stateConstraints } from "../lib/scene/machines";
import type { ScalarValue, Scene } from "../lib/scene/schema";
import { parameterStatus, recordingApplied, type ParameterSuggestion, type Recording } from "../lib/hidden-parameters";
import { findParam } from "../lib/scene/constraints";
import { useRef, useState } from "react";
import { Icon } from "./icons";

type Props = {
  brush: Brush; kind: BrushToolKind; scene: Scene; nodeIds: string[]; state: InspectionState; busy: boolean; running: boolean;
  /** The inspected frame (the active one) and every frame the brush is in, so another can be inspected. */
  frameId?: string; frames?: { id: string; name: string; master: boolean }[]; onFrame?: (frameId: string) => void;
  onCursor: (index: number | null) => void; onClear: () => void;
  /** Take back a what-if value set at the step looked at (a handle dragged there). */
  onResetEdit?: (key: string) => void;
  /** The selected targeted inspection tool (kind "targeted"). */
  targeted?: TargetedTool;
  onFocus: (focus: InspectionFocus | null) => void; onConcern: (text: string) => void; onClearMarks: () => void;
  /** Inspection annotation: make a new targeted tool from the annotation and concern. Targeted: run its concern again. */
  onInspect: () => void;
  /** The Execution frame is only placed with the inspection (AI makes it when its Generate is pressed). */
  deferExecution?: boolean; onDeferExecution?: (on: boolean) => void;
  /** Forks this targeted tool's fixes were applied to (the brush stays), and going to one. */
  forks?: { id: string; name: string; title: string }[]; onOpenFork?: (forkId: string) => void;
  /** Switch to another tool of the group (a toolbar tool id). */
  onTool: (toolId: string) => void;
  /** Hidden parameters the targeted inspection suggests (by index in its list): accept exposes it, reject (or bring back) marks it; an accepted one is adjusted here. */
  onAcceptParameter?: (item: ParameterSuggestion, index: number) => void; onRejectParameter?: (index: number, rejected: boolean) => void;
  onParameterValue?: (nodeId: string, paramId: string, value: ScalarValue["value"]) => void;
  /** The frame's program, and applying the result's item records again (it is applied with the result; Undo apply may take it back). */
  code?: string; onApplyRecording?: (item: Recording) => void;
  /** Changes applied in this frame (newest last: fixes, accepted parameters, item records), undone ones to redo, and whether the frame is still as each left it. */
  applied?: { past: { id: string; title: string; key: string }[]; future: { id: string; title: string; key: string }[]; undoClean: boolean; redoClean: boolean };
  onUndoApplied?: () => void; onRedoApplied?: () => void;
  /** Inspection annotation: drawing (false) or erasing marks (true). */
  eraser?: boolean; onEraser?: (on: boolean) => void;
  /** The pen the next marks are drawn with. */
  pen?: MarkStyle; onPen?: (pen: MarkStyle) => void;
  /** Autocomplete: concerns AI suggested from the inspection annotation (and the typed start), asked with onSuggest; the first that continues the text is shown as its completion (Tab). */
  suggestions?: { items: string[]; loading: boolean; error: string }; onSuggest?: () => void;
  /**
   * Open the Execution frame beside this one with the same brush marks: execution goes step by step, and the state
   * wanted at a moment of it is drawn there.
   */
  onExplore?: () => void;
  /** Whether that Execution frame is open (the button then goes to it). */
  exploring?: boolean;
};

type Suggestion = ParameterSuggestion & { rejected?: boolean };
const parameterFocus = (item: Pick<ParameterSuggestion, "nodeId" | "id">): InspectionFocus => ({ kind: "parameter", nodeId: item.nodeId, id: item.id });
/** What the code does with a suggested value now: the constant it uses, or a scale of 1 on the constants it multiplies. */
const suggestedRange = (item: ParameterSuggestion) => {
  const value = item.value;
  if (item.form === "scale" && value.type === "number") return `Scale ×${formatScalar(value.value)} (${formatScalar(value.min)}–${formatScalar(value.max)})`;
  return value.type === "number" ? `${formatScalar(value.value)}${value.unit} (${formatScalar(value.min)}–${formatScalar(value.max)})` : value.type === "toggle" ? (value.value ? "On" : "Off") : String(value.value);
};
/**
 * Constants the code hard-codes that the concern depends on, suggested as new
 * params. Pending: accept (exposes it, no regeneration) or reject. Accepted:
 * a control right here to try values. Rejected: folded, can be brought back.
 * Clicking one highlights it in the param table (and what overlays show it).
 */
function HiddenParameters({ items, scene, busy, focus, onFocus, onAccept, onReject, onValue }: { items: Suggestion[]; scene: Scene; busy: boolean;
  focus: InspectionFocus | null; onFocus: (focus: InspectionFocus) => void;
  onAccept?: Props["onAcceptParameter"]; onReject?: Props["onRejectParameter"]; onValue?: Props["onParameterValue"] }) {
  return <div className="inspection-parameters"><span className="section-kicker">HIDDEN PARAMETERS</span>
    <span className="inspection-muted">Hard-coded values in the code that relate to this concern. The overlay shows them with the current code values even before Accept. Accept adds them as params you can adjust right away (no code regeneration).</span>
    {items.map((item, i) => {
      const status = parameterStatus(item, scene), node = findNode(scene, item.nodeId), constraint = node?.constraints.find(entry => entry.id === item.constraintId);
      const param = node ? findParam(node, item.id) : undefined, value = param && param.value.type !== "algorithm" ? param.value : null;
      const focused = sameFocus(focus, parameterFocus(item));
      return <div key={`${item.nodeId}:${item.id}`} className={`inspection-parameter ${status} ${focused ? "focused" : ""}`}>
        <button type="button" className="inspection-parameter-head" aria-pressed={focused} title="Highlight it in the params panel" onClick={() => onFocus(parameterFocus(item))}>
          <b><em>{status === "accepted" ? "Added" : status === "rejected" ? "Rejected" : "Suggested"}</em>{item.label}<span>{node?.name ?? item.nodeId} · {constraint?.property ?? item.constraintId}</span></b></button>
        {status !== "rejected" && <span>{item.reason}</span>}
        {status === "pending" && <>
          <code>Current code value {suggestedRange(item)}</code>
          <div className="inspection-parameter-actions">
            <button type="button" className="accept" disabled={busy || !onAccept} onClick={() => onAccept?.(item, i)}><Icon name="plus" size={11} />Accept</button>
            <button type="button" disabled={busy || !onReject} onClick={() => onReject?.(i, true)}>Reject</button>
          </div>
          <details><summary>View code changes</summary>{item.edits.map((edit, k) => <pre key={k}><del>{edit.find}</del>{"\n"}<ins>{edit.replace}</ins></pre>)}</details>
        </>}
        {status === "accepted" && value && <ParameterControl label={item.label} value={value} disabled={!onValue} onChange={next => onValue?.(item.nodeId, item.id, next)} />}
        {status === "accepted" && <small className="inspection-applied-mark">✓ Added as a param · revert with Undo apply</small>}
        {status === "rejected" && onReject && <button type="button" className="inspection-parameter-restore" onClick={() => onReject(i, false)}>Show again</button>}
      </div>;
    })}
  </div>;
}
/** Per-item fields the inspection made the code record, so its overlays can show them on each item. */
function ItemRecords({ item, applied, busy, onApply }: { item: Recording; applied: boolean; busy: boolean; onApply?: Props["onApplyRecording"] }) {
  return <div className={`inspection-records ${applied ? "applied" : ""}`}><span className="section-kicker">ITEM RECORDS</span>
    <span>{applied ? `✓ Records ${item.fields.join(", ")} for each drawn item. The overlay shows per-item values.` : `The current code doesn't record ${item.fields.join(", ")} per item, so the overlay can't show per-item values.`}</span>
    {item.reason && <span className="inspection-muted">{item.reason}</span>}
    {!applied && onApply && <button type="button" disabled={busy} onClick={() => onApply(item)}>Add recording</button>}
    <details><summary>View code changes</summary>{item.edits.map((edit, k) => <pre key={k}><del>{edit.find}</del>{"\n"}<ins>{edit.replace}</ins></pre>)}</details>
  </div>;
}
/** A control for one scalar (number slider, color, toggle, select). */
function ParameterControl({ label, value, disabled, onChange }: { label: string; value: ScalarValue; disabled: boolean; onChange: (value: ScalarValue["value"]) => void }) {
  if (value.type === "number") return <label className="inspection-parameter-control"><input type="range" aria-label={label} min={value.min} max={value.max} step={value.step} value={value.value} disabled={disabled} onChange={e => onChange(Number(e.target.value))} /><output>{formatScalar(value.value)}{value.unit}</output></label>;
  if (value.type === "color") return <label className="inspection-parameter-control"><input type="color" aria-label={label} value={value.value} disabled={disabled} onChange={e => onChange(e.target.value)} /><output>{value.value}</output></label>;
  if (value.type === "toggle") return <label className="inspection-parameter-control"><input type="checkbox" aria-label={label} checked={value.value} disabled={disabled} onChange={e => onChange(e.target.checked)} /><output>{value.value ? "On" : "Off"}</output></label>;
  return <label className="inspection-parameter-control"><select aria-label={label} value={value.value} disabled={disabled} onChange={e => onChange(e.target.value)}>{value.options.map(option => <option key={option}>{option}</option>)}</select></label>;
}

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
 * the track to move between steps (arrow keys, Home/End). The result is held at the step looked at (the latest unless another is picked).
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
    const index = cursor ?? steps.length - 1;
    const next = e.key === "ArrowLeft" ? Math.max(0, index - 1) : e.key === "ArrowRight" ? Math.min(steps.length - 1, index + 1) : e.key === "Home" ? 0 : e.key === "End" ? steps.length - 1 : undefined;
    if (next === undefined) return;
    e.preventDefault(); onCursor(next);
  };
  return <div className="inspection-timeline">
    <div ref={track} className={`timeline-track ${steps.length ? "" : "empty"}`} role="slider" tabIndex={0} aria-label="Recorded steps timeline" aria-valuemin={1} aria-valuemax={Math.max(1, steps.length)}
      aria-valuenow={(cursor ?? steps.length - 1) + 1} aria-valuetext={steps.length ? `Step ${(cursor ?? steps.length - 1) + 1}: ${label(steps[cursor ?? steps.length - 1]).event}` : "No steps"}
      onKeyDown={key}
      onPointerDown={e => { if (!steps.length) return; scrubbing.current = true; e.currentTarget.setPointerCapture(e.pointerId); pick(e.clientX); }}
      onPointerMove={e => { if (scrubbing.current) pick(e.clientX); }}
      onPointerUp={() => { scrubbing.current = false; }} onPointerCancel={() => { scrubbing.current = false; }}>
      <span className="timeline-rail" />
      {steps.length > 0 && <span className="timeline-progress" style={{ width: at(positions[cursor ?? steps.length - 1]) }} />}
      {steps.map((item, i) => {
        const text = label(item);
        return <span key={item.id} className={`timeline-mark ${item.nodeId ? "transition" : "capture"} ${i === (cursor ?? steps.length - 1) ? "current" : ""}`} style={{ left: at(positions[i]) }} aria-label={`Step ${i + 1}: ${text.event}`}>
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
    <label><span>Width</span><input type="range" aria-label="Pen width" min={1} max={30} step={1} value={pen.width} onChange={e => onPen({ ...pen, width: e.currentTarget.valueAsNumber })} /><b>{pen.width}px</b></label>
    <label><span>Opacity</span><input type="range" aria-label="Pen opacity" min={10} max={100} step={5} value={Math.round(pen.opacity * 100)} onChange={e => onPen({ ...pen, opacity: e.currentTarget.valueAsNumber / 100 })} /><b>{Math.round(pen.opacity * 100)}%</b></label>
  </div>;
}

/** The properties an owner holds at a step (its FSM data in the step's runtime), by property name. */
function ownerData(step: InspectionState["steps"][number]) {
  const owners = step.runtime && typeof step.runtime === "object" ? (step.runtime as { owners?: Record<string, Record<string, { state?: string; data?: Record<string, unknown> }>> }).owners : undefined;
  return owners?.[step.nodeId ?? ""]?.[step.key ?? ""]?.data ?? {};
}
const shortData = (value: unknown): string => typeof value === "number" ? formatScalar(Math.round(value * 100) / 100) : typeof value === "string" || typeof value === "boolean" ? String(value).slice(0, 24)
  : value && typeof value === "object" && Number.isFinite((value as { x?: number }).x) && Number.isFinite((value as { y?: number }).y) ? `(${Math.round((value as { x: number }).x)}, ${Math.round((value as { y: number }).y)})`
  : Array.isArray(value) ? `[${value.length}]` : value === undefined ? "—" : "{…}";
/**
 * Within a state machine step: the constraints the state it enters evaluates, in order, each with the property it
 * holds at that moment. Stepping through them (◀ ▶) focuses one constraint after another, as execution computes them.
 */
function StateConstraints({ step, scene, focus, onFocus }: { step: InspectionState["steps"][number]; scene: Scene; focus: InspectionFocus | null; onFocus: (item: InspectionFocus | null) => void }) {
  const owner = step.nodeId ? findNode(scene, step.nodeId) : undefined, list = owner && step.to ? stateConstraints(owner, step.to) : [], data = ownerData(step);
  if (!owner || !list.length) return null;
  const at = list.findIndex(item => focus?.kind === "constraint" && focus.nodeId === owner.id && focus.id === item.id);
  const go = (i: number) => onFocus({ kind: "constraint", nodeId: owner.id, id: list[Math.max(0, Math.min(list.length - 1, i))].id });
  return <div className="inspection-state-constraints" aria-label="Constraints this state evaluates">
    <span className="inspection-subtitle">CONSTRAINTS IN ORDER
      <span className="inspection-constraint-stepper"><button type="button" aria-label="Previous constraint" disabled={at <= 0} onClick={() => go(at - 1)}>◀</button>
        <output>{at < 0 ? "–" : at + 1} / {list.length}</output>
        <button type="button" aria-label="Next constraint" disabled={at >= list.length - 1} onClick={() => go(at + 1)}>▶</button></span></span>
    <ol>{list.map((item, i) => <li key={item.id}><button type="button" className={i === at ? "focused" : ""} title={item.description} onClick={() => onFocus(i === at ? null : { kind: "constraint", nodeId: owner.id, id: item.id })}>
      <b>{item.property}</b><span>{shortData(data[item.property])}</span></button></li>)}</ol>
  </div>;
}

/**
 * Inspection of one brush: step through the recorded states and transitions
 * (up to MAX_STEPS) and see every param value change. With the inspection
 * annotation tool the user marks a concern, which becomes a new targeted
 * inspection tool (AI overlays, and an Execution frame where the state wanted is drawn).
 */
export function InspectionPanel(props: Props) {
  const deferSwitch = props.onDeferExecution && <label className="inspection-preview-switch" title="With it on, the Execution frame is placed but made only when you press Generate in it">
    <input type="checkbox" checked={Boolean(props.deferExecution)} disabled={props.busy} onChange={e => props.onDeferExecution!(e.target.checked)} />Generate Execution exploration later (frame only)</label>;
  const { brush, scene, nodeIds, state, busy } = props;
  // Reset history asks once more, in place, before deleting the steps.
  const [confirmReset, setConfirmReset] = useState(false);
  // Undo/redo of an applied change asks first when the frame changed since (those later edits go too).
  const [confirmStep, setConfirmStep] = useState<"undo" | "redo" | null>(null);
  const annotating = props.kind === "inspect-annotate", targeted = props.kind === "targeted" ? props.targeted : undefined;
  const frames = props.frames ?? [];
  if (!nodeIds.length) return <div className="inspection-empty"><Icon name="inspect" size={24} /><strong>This frame has no {brush.name} brush.</strong>
    <span>{frames.length ? "Pick a frame to inspect, or add a brush to this frame with the Brush tool." : "Add a brush to this frame with the Brush tool."}</span>
    {frames.length > 0 && <div className="inspection-frame-list">{frames.map(frame => <button key={frame.id} onClick={() => props.onFrame?.(frame.id)}>{frame.master ? "◆" : "◇"} {frame.name}<small>{frame.master ? "master" : "instance"}</small></button>)}</div>}</div>;
  const steps = state.steps, index = state.cursor ?? steps.length - 1, step = steps[index];
  const changed = changedKeys(steps, index), rows = paramRows(scene, nodeIds);
  const node = (id: string | null) => id ? findNode(scene, id) : undefined;
  const stateLabel = (nodeId: string | null, id: string | null) => id ? node(nodeId)?.machine?.states.find(item => item.id === id)?.label || id : "—";
  const transition = step?.nodeId && step.transitionId ? node(step.nodeId)?.machine?.transitions.find(item => item.id === step.transitionId) : undefined;
  const focus = (item: InspectionFocus) => props.onFocus(sameFocus(state.focus, item) ? null : item);
  const owner = (item: (typeof steps)[number]) => `${node(item.nodeId)?.name ?? item.nodeId}${item.key ? ` #${item.key}` : ""}`;
  const stepTitle = (item: (typeof steps)[number]) => item.nodeId ? `${owner(item)}: ${stateLabel(item.nodeId, item.from)} → ${stateLabel(item.nodeId, item.to)}` : "Start";
  /** What a timeline mark says on hover: the transition (or capture) and the state change. */
  const stepLabel = (item: (typeof steps)[number]) => {
    const via = item.nodeId && item.transitionId ? node(item.nodeId)?.machine?.transitions.find(entry => entry.id === item.transitionId) : undefined;
    return item.nodeId ? { event: via?.label || via?.id || "Time / direct move", detail: stepTitle(item) } : { event: stepTitle(item), detail: "Values at this point" };
  };
  const result = targeted?.result ?? null;
  /** Undo / redo a whole applied change: scene, code and prompt together. */
  const appliedBar = props.applied && (props.applied.past.length > 0 || props.applied.future.length > 0) && <div className="inspection-applied-bar"><span className="section-kicker">APPLIED</span>
    {confirmStep ? <span className="inspection-reset-confirm" role="group" aria-label="Confirm undo">
        Changes made after applying will also be {confirmStep === "undo" ? "reverted" : "overwritten"}.
        <button className="danger" onClick={() => { const step = confirmStep; setConfirmStep(null); (step === "undo" ? props.onUndoApplied : props.onRedoApplied)?.(); }}>{confirmStep === "undo" ? "Undo" : "Redo"}</button>
        <button onClick={() => setConfirmStep(null)}>Cancel</button></span>
      : <span className="inspection-applied-actions">
        <button disabled={busy || !props.applied.past.length} title={props.applied.past.length ? `Undo “${props.applied.past.at(-1)!.title}” (scene and code)` : "Nothing applied"}
          onClick={() => props.applied!.undoClean ? props.onUndoApplied?.() : setConfirmStep("undo")}><Icon name="undo" size={12} />Undo apply</button>
        <button disabled={busy || !props.applied.future.length} title={props.applied.future.length ? `Redo “${props.applied.future.at(-1)!.title}”` : "Nothing to redo"}
          onClick={() => props.applied!.redoClean ? props.onRedoApplied?.() : setConfirmStep("redo")}><Icon name="redo" size={12} />Redo</button></span>}</div>;
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
      </span>
      {confirmReset && steps.length ? <span className="inspection-reset-confirm" role="group" aria-label="Confirm reset">
          Delete {steps.length} steps?
          <button className="danger" onClick={() => { setConfirmReset(false); props.onClear(); }}>Reset</button>
          <button onClick={() => setConfirmReset(false)}>Cancel</button>
        </span>
        : <button title={`Delete this brush's recorded history in this frame (${steps.length} steps) `} disabled={!steps.length} onClick={() => setConfirmReset(true)}><Icon name="trash" size={12} />Reset history</button>}
    </div>
    <StepTimeline steps={steps} cursor={state.cursor} label={stepLabel} onCursor={props.onCursor} />
    {/* The running state moved by a handle at this step (the input bent, a store value): only this step is drawn with it. */}
    {(() => { const moved = Object.keys(step?.edits ?? {}).filter(isRuntimeKey); return moved.length > 0 && props.onResetEdit && <div className="inspection-timeline-hint"><span className="inspection-hint">
      This step's {moved.some(key => key.startsWith(INPUT_KEY)) ? "input path" : "run state"} was moved with a handle and redrawn ({moved.length} places).</span>
      <button type="button" onClick={() => moved.forEach(key => props.onResetEdit!(key))}>Reset</button></div>; })()}
    {!steps.length && <div className="inspection-timeline-hint"><span className="inspection-hint">{props.running ? `Recorded automatically whenever the result changes state (up to ${MAX_STEPS}). Try moving this frame's brush with the Brush tool.` : "Generate this frame's result first."}</span></div>}
    <div className="inspection-content">
      <section className="inspection-side">
        {step && <div className="inspection-step-detail">
          <span className="section-kicker">STEP {index + 1}</span>
          {step.nodeId ? <>
            <strong>{owner(step)}</strong>
            <div className="inspection-chips">
              <button className={sameFocus(state.focus, { kind: "state", nodeId: step.nodeId, id: step.from || "" }) ? "focused" : ""} disabled={!step.from} onClick={() => step.from && focus({ kind: "state", nodeId: step.nodeId!, id: step.from })}>{stateLabel(step.nodeId, step.from)}</button>
              <span>→</span>
              <button className={sameFocus(state.focus, { kind: "state", nodeId: step.nodeId, id: step.to || "" }) ? "focused" : ""} onClick={() => step.to && focus({ kind: "state", nodeId: step.nodeId!, id: step.to })}>{stateLabel(step.nodeId, step.to)}</button>
            </div>
            {transition ? <button className={`inspection-transition ${sameFocus(state.focus, { kind: "transition", nodeId: step.nodeId, id: transition.id }) ? "focused" : ""}`} onClick={() => focus({ kind: "transition", nodeId: step.nodeId!, id: transition.id })}>
              <Icon name="arrow" size={12} />{transition.label}<small>event “{transition.event}”</small></button>
              : <small className="inspection-muted">Moved without a transition (restart or direct move)</small>}
            <StateConstraints step={step} scene={scene} focus={state.focus} onFocus={item => props.onFocus(item)} />
          </> : <span className="inspection-muted">{stepTitle(step)} · recorded the values at this point.</span>}
          <span className="inspection-muted">{changed.size ? `${[...changed].filter(key => !key.includes("/@")).length} param values differ from the previous step.` : index > 0 ? "Same values as the previous step." : ""}</span>
        </div>}
        {annotating && <form className="inspection-concern" onSubmit={e => { e.preventDefault(); props.onInspect(); }}>
          <span className="section-kicker">INSPECTION ANNOTATION</span>
          <span className="inspection-muted">Mark what you want to know about on the frame (circles, notes) and write a concern; a targeted inspection tool for that concern then appears in this brush group.</span>
          {props.onEraser && <div className="inspection-draw-mode" role="radiogroup" aria-label="Inspection annotation mode">
            <button type="button" role="radio" aria-checked={!props.eraser} className={!props.eraser ? "active" : ""} onClick={() => props.onEraser!(false)}><Icon name="inspect-pen" size={12} />Pen</button>
            <button type="button" role="radio" aria-checked={Boolean(props.eraser)} className={props.eraser ? "active" : ""} title="Drag over marks on the frame to erase them (E)" onClick={() => props.onEraser!(true)}><Icon name="eraser" size={12} />Eraser</button>
            {props.eraser && <span className="inspection-muted">Rub over the marks on the frame to erase them.</span>}</div>}
          {props.pen && props.onPen && !props.eraser && <MarkPen pen={props.pen} onPen={props.onPen} />}
          <div className="inspection-chips">
            {state.marks.length > 0 ? <span className="machine-attachment machine-attachment-annotation inspection-mark-chip"><Icon name="inspect-pen" size={12} /><b>Inspection annotation</b>{state.marks.length} stroke{state.marks.length === 1 ? "" : "s"} attached
              <button type="button" aria-label="Clear inspection annotation" onClick={props.onClearMarks}><Icon name="close" size={11} /></button></span>
              : <span className="inspection-muted">No annotation yet.</span>}
          </div>
          {(() => {
            // The typed text, then (in grey) how the best suggestion completes it; Tab takes it.
            const items = props.suggestions?.items ?? [], completion = items.map(item => concernCompletion(state.concern, item)).find(Boolean) ?? "";
            const placeholder = !state.concern && items[0] ? items[0] : "e.g. I want to know how the star size changes at each step";
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
                  {!props.suggestions.loading && (items.length ? (completion || (!state.concern && items[0])) && <span><kbd>Tab</kbd> to insert</span> : props.suggestions.error && <span>{props.suggestions.error}</span>)}</span>
                {items.map(item => <button type="button" key={item} className={`concern-suggestion ${item === state.concern ? "chosen" : ""}`} onClick={() => props.onConcern(item)}>{item}</button>)}
              </div>}
            </>;
          })()}
          {deferSwitch}
          <button type="submit" className="primary" disabled={busy || !(state.concern.trim() || state.marks.length)}><Icon name="target" size={13} />{busy ? "Creating…" : "Create targeted inspection"}</button>
        </form>}
        {targeted && <div className="inspection-concern">
          <span className="section-kicker">TARGETED INSPECTION</span>
          <strong>{targeted.name}</strong>
          {targeted.concern && <span className="inspection-muted">{targeted.concern}</span>}
          {targeted.timing && <small className="inspection-timing">Last inspection {(targeted.timing.ms / 1000).toFixed(1)}s</small>}
          {deferSwitch}
          <button type="button" className="inspection-apply-all" disabled={busy} title="Build this inspection again from the current steps" onClick={props.onInspect}><Icon name="target" size={12} />{busy ? "Inspecting…" : "Inspect again"}</button>
        </div>}
        {result && <div className="inspection-result">
          <p>{result.summary}</p>
          {/* The process under the hand in a frame of its own: step to the moment the concern is about and draw the state wanted there. */}
          {props.onExplore && <div className="inspection-explore"><span className="inspection-muted">Step to the moment, then draw the state you want there with the tools AI makes for it: the brush is fixed to what you draw.</span>
            <button type="button" className="inspection-explore-button execution" disabled={busy} title="Open the Execution frame with the same brush marks: run their execution back and forth, and draw the state you want at a moment"
              onClick={props.onExplore}><Icon name="play" size={11} />Execution · draw the state you want{props.exploring && <small>Open · go</small>}</button></div>}
          {result.overlays.length > 0 && <div className="inspection-legend">{result.overlays.map(overlay => <button key={overlay.id} className={sameFocus(state.focus, overlay.link) ? "focused" : ""} onClick={() => focus(overlay.link)}>
            <i style={{ background: overlay.color }} />{overlay.name || overlay.label.replace(/\$\{[^}]*\}/g, "…").trim() || overlay.id}</button>)}</div>}
          {result.records && <ItemRecords item={result.records} applied={recordingApplied(scene, props.code ?? "", result.records)} busy={busy} onApply={props.onApplyRecording} />}
          {result.parameters.length > 0 && <HiddenParameters items={result.parameters} scene={scene} busy={busy} focus={state.focus} onFocus={focus} onAccept={props.onAcceptParameter} onReject={props.onRejectParameter} onValue={props.onParameterValue} />}
          {/* Fixes applied to forks of the brush from what was drawn in the Execution frame. */}
          {(props.forks ?? []).length > 0 && <div className="inspection-forks"><span className="section-kicker">FIXED IN FORKS</span>
            {props.forks!.map(fork => <button key={fork.id} type="button" className="inspection-fork-link" title="Go to this fork (its frame, with its targeted tool)" onClick={() => props.onOpenFork?.(fork.id)}>⑂ {fork.title}<small>{fork.name}</small><Icon name="arrow" size={11} /></button>)}</div>}
          {appliedBar}
        </div>}
      </section>
      <section className="inspection-table" aria-label="Param values">
        <table><thead><tr><th>Param</th><th>Value</th><th>Δ</th><th>Steps</th></tr></thead><tbody>
          {rows.map(row => {
            // A what-if value set at this step only (by a handle) shows over the recorded one.
            const value = stepValues(step)?.[row.key], previous = stepValues(steps[index - 1])?.[row.key], edited = Boolean(step?.edits && row.key in step.edits);
            // Single drawn items with their own what-if value of it at this step.
            const items = Object.values(step?.itemEdits ?? {}).filter(own => row.key in own).length;
            const delta = typeof value === "number" && typeof previous === "number" && value !== previous ? value - previous : null;
            const numbers = steps.map(item => stepValues(item)![row.key]).filter((item): item is number => typeof item === "number");
            const low = Math.min(...numbers), high = Math.max(...numbers);
            const item: InspectionFocus = { kind: "param", nodeId: row.binding.nodeId, id: row.binding.path[0] };
            return <tr key={row.key} className={`${changed.has(row.key) ? "changed" : ""} ${edited || items ? "edited" : ""} ${sameFocus(state.focus, item) ? "focused" : ""}`} onClick={() => focus(item)}>
              <td><span className="inspection-node">{row.node}</span><span>{row.constraint && `${row.constraint} · `}<b>{row.param}</b>{row.path && ` › ${row.path}`}</span>
                {(edited || items > 0) && <span className="inspection-step-edit" title={edited ? `Recorded ${formatScalar(step!.values[row.key])}; this step is drawn with ${formatScalar(value)} only` : `${items} drawn item(s) at this step have their own value`}>
                  {edited ? `This step only (recorded ${formatScalar(step!.values[row.key])})` : ""}{edited && items ? " · " : ""}{items ? `${items} items only` : ""}
                  {props.onResetEdit && <button type="button" aria-label={`Reset ${row.param} at this step`} title="Back to the recorded value" onClick={e => { e.stopPropagation(); props.onResetEdit!(row.key); }}><Icon name="close" size={9} /></button>}</span>}</td>
              <td className="inspection-value">{row.binding.type === "color" && typeof value === "string" ? <i className="inspection-color" style={{ background: value }} /> : null}{formatScalar(value)}</td>
              <td className="inspection-delta">{delta !== null ? `${delta > 0 ? "+" : ""}${formatScalar(delta)}` : changed.has(row.key) ? "changed" : ""}</td>
              <td className="inspection-trace">{steps.map((item, i) => { const v = stepValues(item)![row.key];
                const height = typeof v === "number" && high > low ? 3 + (v - low) / (high - low) * 13 : 8;
                return <i key={item.id} className={i === index ? "current" : ""} title={`${i + 1}: ${formatScalar(v)}`} style={{ height, background: row.binding.type === "color" && typeof v === "string" ? v : undefined }} />; })}</td>
            </tr>;
          })}
          {!rows.length && <tr><td colSpan={4} className="inspection-muted">This brush has no param values to adjust.</td></tr>}
        </tbody></table>
      </section>
    </div>
  </div>;
}
