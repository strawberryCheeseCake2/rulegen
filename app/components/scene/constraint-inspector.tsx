import type { Algorithm, Effect, NodeState, NodeTransition, Param, ParamHandle, ScalarValue, SceneNode, Constraint } from "../../lib/scene/schema";
import { POINTER_SOURCES } from "../../lib/scene/schema";
import { dragLinks, pointerLinks, type DragLink, type PointerLink } from "../../lib/scene/constraints";
import { SOURCE_NAMES } from "../../lib/scene/drag-adjust";
import { handleFits, handleLeaves, type HandleTarget } from "../../lib/scene/handles";
import { MAX_NODE_PARAMS, MAX_PARAMS, MAX_CONSTRAINTS } from "../../lib/scene/schema";
import type { SlotChoice } from "../../lib/scene/panel-ops";
import { createContext, useContext, useEffect, useState } from "react";
import { ALGORITHM_DRAG_TYPE, readAlgorithmDrag, type AlgorithmClip } from "../../lib/scene/transfer";
import { Icon } from "../icons";
import type { TransformDraft, TransformTarget } from "../../lib/sketch-panels";
import { ValueSocket } from "./value-editor";
import { useContextMenu } from "./context-menu";

export type ConstraintInspectorProps = {
  /** The constraints shown: the selected state's, in its evaluation order; without one, all of the node's in declaration order. */
  node: SceneNode; constraints: Constraint[]; library: Algorithm[]; state: NodeState | undefined; busy: boolean; clip: AlgorithmClip | null;
  onNode: (patch: Partial<Pick<SceneNode, "name" | "description">>) => void;
  onConstraint: (constraintId: string, patch: Partial<Pick<Constraint, "property" | "description">>) => void;
  onAddConstraint: () => void;
  onRemoveConstraint: (constraintId: string) => void;
  onMoveConstraint: (constraintId: string, offset: number) => void;
  /** Whether the selected state evaluates a constraint. */
  onStateConstraint: (constraintId: string, included: boolean) => void;
  onChooseState: (stateId: string | null) => void;
  onState: (patch: Partial<Pick<NodeState, "label" | "description">>) => void;
  onTransition: (id: string, patch: Partial<Pick<NodeTransition, "label" | "event" | "to">>) => void;
  onScalar: (paramId: string, path: string[], value: ScalarValue["value"]) => void;
  /** Turn a value drag off (the value is then adjusted by its param only) or on again. */
  onDragOff?: (constraintId: string, dragIndex: number, off: boolean) => void;
  onSwap: (paramId: string, path: string[], choice: SlotChoice) => void;
  onParam: (paramId: string, patch: Partial<Pick<Param, "label" | "effect">>) => void;
  onRemoveParam: (paramId: string) => void;
  onAddParam: (algorithmId: string, constraintId: string) => void;
  onAddBlock: (clip: AlgorithmClip, constraintId: string) => void;
  /** AI: open the regeneration composer for one param, one constraint, or (empty target) a new stacked constraint. */
  onRegenerate: (target: TransformTarget) => void;
  /** The open regeneration of this node (its text and frame annotation), and its actions. */
  draft?: TransformDraft | null;
  onDraftChange?: (patch: Partial<Pick<TransformDraft, "instruction" | "annotating" | "marks">>) => void;
  onDraftSubmit?: () => void; onDraftCancel?: () => void;
  /** Open a new frame that renders only this constraint. */
  onMinimalExample?: (constraintId: string) => void;
  /** A param picked in inspection: its card is highlighted and scrolled into view. */
  highlightParamId?: string | null;
  /** A constraint picked elsewhere (an Execution frame, the Layers panel): its card is highlighted and scrolled into view. */
  highlightConstraintId?: string | null;
  onMakePen: (paramId: string, path: string[]) => void;
  onCopy: (paramId: string, path: string[]) => void;
  onPaste: (paramId: string, path: string[], dropped?: AlgorithmClip) => void;
  clipFor: (paramId: string, path: string[]) => AlgorithmClip | null;
  onGenerateMachine: () => void;
  onRemoveMachine: () => void;
  /** A param's direct manipulation handle changed (its hint) or removed (null). */
  onHandle?: (paramId: string, handle: ParamHandle | null) => void;
  /** AI makes the interface for one param, a constraint's params, or (empty) every param of the node; `instruction` says how. */
  onDesignHandles?: (target: HandleTarget, instruction?: string) => void;
  /** Open (or create) this node's proxy frame, where its handles run. */
  onOpenProxy?: () => void;
  /** Runtime errors of handles in the proxy frame, by param id. */
  handleErrors?: Record<string, string>;
  /**
   * Hidden constants a targeted inspection suggests exposing on this node, not
   * decided yet: shown faintly in the constraint they would join, to accept
   * (it becomes a param) or reject. `index`: its place in the inspection's list.
   */
  suggestions?: { item: SuggestedParam; index: number }[];
  onAcceptSuggestion?: (index: number) => void; onRejectSuggestion?: (index: number) => void;
};
/** What the inspector shows of a suggested hidden parameter. */
export type SuggestedParam = Pick<Param, "id" | "label" | "effect" | "description"> & { constraintId: string; value: ScalarValue; reason: string; form?: "constant" | "scale" };

const effects: Effect[] = ["spatial", "stylistic", "temporal"];

function StateBar({ node, state, onChooseState }: Pick<ConstraintInspectorProps, "node" | "state" | "onChooseState">) {
  if (!node.machine) return null;
  return <div className="state-chip-bar" role="group" aria-label={`${node.name} states`}>
    <button className={!state ? "active" : ""} aria-pressed={!state} title="Every constraint of the node, in declaration order" onClick={() => onChooseState(null)}>All constraints</button>
    {node.machine.states.map(item => <button key={item.id} className={state?.id === item.id ? "active" : ""} aria-pressed={state?.id === item.id} onClick={() => onChooseState(item.id)}>{item.label}{node.machine!.initialState === item.id && <small>initial</small>}</button>)}
  </div>;
}

function StateDetails({ node, state, onState, onTransition }: Pick<ConstraintInspectorProps, "node" | "state" | "onState" | "onTransition">) {
  if (!state || !node.machine) return null;
  const outgoing = node.machine.transitions.filter(transition => transition.from === state.id);
  return <section className="inspector-state" aria-label="Selected state">
    <input aria-label="State name" maxLength={100} value={state.label} onChange={e => { if (e.target.value.trim()) onState({ label: e.target.value }); }} />
    <textarea aria-label="State description" maxLength={1000} rows={2} value={state.description} onChange={e => onState({ description: e.target.value })} />
    <span className="inspector-subtitle">Transitions</span>
    {outgoing.map(transition => <div className="state-transition" key={transition.id}>
      <input className="transition-semantic-input" aria-label={`Transition ${transition.id} semantic label`} maxLength={100} value={transition.label} onChange={e => { if (e.target.value.trim()) onTransition(transition.id, { label: e.target.value }); }} />
      <label className="transition-event" title="The event the code dispatches (owner.dispatch) to take this transition">on <input aria-label={`Transition ${transition.label} event`} maxLength={80} value={transition.event} onChange={e => { const value = e.target.value.trim().replace(/\s+/g, "-"); if (value) onTransition(transition.id, { event: value }); }} /></label>
      <Icon name="arrow" size={12} />
      <select aria-label={`Transition ${transition.label} target`} value={transition.to} onChange={e => onTransition(transition.id, { to: e.target.value })}>{node.machine!.states.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
    </div>)}
    {!outgoing.length && <p className="state-method-description">No outgoing transitions</p>}
  </section>;
}

const sameTarget = (a: TransformTarget, b: TransformTarget) => (a.constraintId || "") === (b.constraintId || "") && (a.paramId || "") === (b.paramId || "");

/**
 * Regenerate with AI: says what is attached (a param, a constraint, or a
 * new constraint), takes how to change it and an annotation drawn on the frame.
 */
function RegenerateComposer({ props, what }: { props: ConstraintInspectorProps; what: string }) {
  const draft = props.draft!, busy = props.busy;
  const kind = draft.target.paramId ? "Param" : draft.target.constraintId ? "Constraint" : "New constraint";
  return <form className="regenerate-composer" aria-label="Regenerate with AI" onSubmit={e => { e.preventDefault(); props.onDraftSubmit?.(); }}>
    <span className="section-kicker">REGENERATE WITH AI</span>
    <div className="inspection-chips"><span className="machine-attachment"><Icon name="spark" size={12} /><b>{kind}</b>{what} attached</span></div>
    <textarea aria-label="How to regenerate" maxLength={2000} rows={3} autoFocus placeholder={draft.target.constraintId || draft.target.paramId ? "Describe how to change it. e.g. branches get thinner toward the top" : "Describe which constraint to add. e.g. sway in the wind"}
      value={draft.instruction} onChange={e => props.onDraftChange?.({ instruction: e.target.value })} />
    <div className="regenerate-annotation">
      {draft.marks.length > 0 ? <span className="machine-attachment machine-attachment-annotation"><Icon name="pen" size={12} /><b>Annotation</b>{draft.marks.length} stroke{draft.marks.length === 1 ? "" : "s"} attached
        <button type="button" aria-label="Clear annotation" onClick={() => props.onDraftChange?.({ marks: [] })}><Icon name="close" size={11} /></button></span>
        : <span className="inspection-muted">You can draw on the frame to point at what to change.</span>}
      <button type="button" className={draft.annotating ? "active" : ""} aria-pressed={draft.annotating} onClick={() => props.onDraftChange?.({ annotating: !draft.annotating })}>
        <Icon name="pen" size={12} />{draft.annotating ? "Done drawing" : "Draw on frame"}</button>
    </div>
    <div className="regenerate-actions">
      <button type="submit" className="primary" disabled={busy}><Icon name="spark" size={12} />{busy ? "Regenerating…" : "Regenerate"}</button>
      <button type="button" onClick={props.onDraftCancel}>Cancel</button>
    </div>
  </form>;
}

/** An empty socket at the end of the list: drop (or pick) a block to add a param. */
function NewSocket({ library, busy, onAdd, onDrop }: { library: Algorithm[]; busy: boolean; onAdd: (id: string) => void; onDrop: (clip: AlgorithmClip) => void }) {
  const [over, setOver] = useState(false);
  return <div className={`value-socket new-socket accepts-blocks ${over ? "socket-over" : ""}`}
    onDragOver={event => { if (busy || !event.dataTransfer.types.includes(ALGORITHM_DRAG_TYPE)) return; event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setOver(true); }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOver(false); }}
    onDrop={event => { setOver(false); const clip = readAlgorithmDrag(event.dataTransfer); if (clip) { event.preventDefault(); onDrop(clip); } }}>
    <span className="socket-hint">+ Drop a ƒ block here to add a param to this constraint</span>
    {library.length > 0 && <select aria-label="Add param from algorithm" value="" disabled={busy} onChange={e => { if (e.target.value) onAdd(e.target.value); }}><option value="">or pick a block…</option>{library.map(algorithm => <option key={algorithm.id} value={algorithm.id}>ƒ {algorithm.name}</option>)}</select>}
  </div>;
}

/** The param's direct manipulation interface: what it does, what it drives, its code, and how to change it with AI. */
function HandleEditor({ param, props }: { param: Param; props: ConstraintInspectorProps }) {
  const handle = param.handle!, error = props.handleErrors?.[param.id], fits = handleFits(param);
  const [instruction, setInstruction] = useState("");
  const redesign = (text: string) => { props.onDesignHandles?.({ paramId: param.id }, error ? fixInstruction(error, text) : text); setInstruction(""); };
  return <div className={`handle-editor ${error || !fits ? "stale" : ""}`} role="group" aria-label={`${param.label} handle`}>
    <div className="handle-editor-row">
      <span className="handle-editor-kicker">◎ PROXY HANDLE</span>
      <span className="handle-editor-drives" title="Scalars this interface drives">{handle.paths.map(path => path.join(" › ") || param.label).join(", ")}</span>
      {props.onOpenProxy && <button type="button" title="Open the proxy frame where this handle runs" onClick={props.onOpenProxy}>Open proxy</button>}
      <button type="button" className="remove-control" aria-label={`Remove ${param.label} handle`} title="Remove this handle" onClick={() => props.onHandle?.(param.id, null)}><Icon name="close" size={11} /></button>
    </div>
    <input aria-label={`${param.label} handle hint`} maxLength={120} placeholder="What the gesture does, e.g. drag to spread the branches" value={handle.hint} onChange={e => props.onHandle?.(param.id, { ...handle, hint: e.target.value })} />
    {!fits && <p className="handle-editor-error">The value structure changed, so the value this handle adjusted is gone. Please regenerate it.</p>}
    {error && <p className="handle-editor-error" role="alert">⚠ {error}</p>}
    <form className="handle-editor-row" onSubmit={e => { e.preventDefault(); redesign(instruction); }}>
      <input aria-label={`How to change the ${param.label} handle`} maxLength={600} placeholder="How to change it (optional) e.g. grab the petals directly to rotate them" value={instruction} onChange={e => setInstruction(e.target.value)} />
      <button type="submit" disabled={props.busy}><Icon name="spark" size={11} />{error || !fits ? "Fix with AI" : "Redesign"}</button>
    </form>
    <details className="handle-code"><summary>Widget code</summary><pre>{handle.code}</pre></details>
  </div>;
}
// The fix request carries the error, so the model sees what went wrong.
const fixInstruction = (error: string, instruction: string) => `${instruction.trim() ? `${instruction.trim()}\n` : ""}The current widget fails at runtime: ${error}. Fix it.`;

function ParamCard({ param, props, openMenu }: { param: Param; props: ConstraintInspectorProps; openMenu: ReturnType<typeof useContextMenu>[1] }) {
  const { library } = props, state = undefined;
  const { linked } = useContext(PointerContext), constraintId = props.constraints.find(item => item.params.some(other => other.id === param.id))?.id ?? "";
  return <article className={`param-card effect-${param.effect} ${props.highlightParamId === param.id || linked?.paramId === param.id ? "inspection-highlight" : ""}`} data-param-id={param.id}>
    <div className="param-card-title">
      <input aria-label={`${param.label} param name`} maxLength={80} value={param.label} disabled={Boolean(state)} onChange={e => { if (e.target.value.trim()) props.onParam(param.id, { label: e.target.value }); }} />
      <select className="effect-select" aria-label={`${param.label} effect`} value={param.effect} disabled={Boolean(state)} onChange={e => props.onParam(param.id, { effect: e.target.value as Effect })}>{effects.map(effect => <option key={effect} value={effect}>{effect}</option>)}</select>
      {!state && <button className="subfeature-regenerate" aria-label={`Regenerate ${param.label}`} title="Regenerate this param with AI" onClick={() => props.onRegenerate({ paramId: param.id })}><Icon name="spark" size={12} /></button>}
      {!state && props.onDesignHandles && !param.handle && handleLeaves(param).length > 0 && <button className="subfeature-regenerate handle-create" aria-label={`Design a direct manipulation handle for ${param.label}`} title="AI makes a direct manipulation interface for this param (runs in the proxy frame)" disabled={props.busy} onClick={() => props.onDesignHandles!({ paramId: param.id })}><Icon name="target" size={12} /></button>}
      {!state && <button className="remove-control" aria-label={`Delete ${param.label} param`} title="Delete param" onClick={() => props.onRemoveParam(param.id)}><Icon name="close" size={13} /></button>}
    </div>
    <PointerChips constraintId={constraintId} paramId={param.id} />
    {props.draft && sameTarget(props.draft.target, { paramId: param.id }) && <RegenerateComposer props={props} what={param.label} />}
    {param.description && <p className="param-description">{param.description}</p>}
    {param.handle && props.onHandle && !state && <HandleEditor param={param} props={props} />}
    <ValueSocket value={param.value} label={param.label} path={[]} library={library} clip={props.clip} allowSwap={!state} root openMenu={openMenu} clipFor={path => props.clipFor(param.id, path)}
      onScalar={(path, value) => props.onScalar(param.id, path, value)} onSwap={(path, choice) => props.onSwap(param.id, path, choice)}
      onCopy={path => props.onCopy(param.id, path)} onPaste={(path, dropped) => props.onPaste(param.id, path, dropped)} onMakePen={path => props.onMakePen(param.id, path)} />
  </article>;
}

/**
 * A hidden parameter suggested by a targeted inspection: not a param yet, so it
 * is faint and read-only, at the value the code uses now, until accepted or rejected.
 */
function SuggestedCard({ item, index, props }: { item: SuggestedParam; index: number; props: ConstraintInspectorProps }) {
  const value = item.value, scale = item.form === "scale" && value.type === "number";
  const shown = value.type === "number" ? `${scale ? "×" : ""}${Math.round(value.value * 1000) / 1000}${scale ? "" : value.unit}` : value.type === "toggle" ? (value.value ? "On" : "Off") : String(value.value);
  return <article className={`param-card suggested-param effect-${item.effect} ${props.highlightParamId === item.id ? "inspection-highlight" : ""}`} data-param-id={item.id} aria-label={`Suggested parameter ${item.label}`}>
    <div className="param-card-title">
      <b>{item.label}</b><em className="suggested-tag" title="Targeted inspection suggests exposing this hard-coded value">Suggested</em>
      <span className="effect-select">{item.effect}</span>
    </div>
    {item.description && <p className="param-description">{item.description}</p>}
    {item.reason && <p className="param-description suggested-reason">{item.reason}</p>}
    <div className="suggested-value">
      {value.type === "number" && <input type="range" aria-label={`${item.label} (suggested)`} min={value.min} max={value.max} step={value.step} value={value.value} disabled readOnly />}
      <output>{scale ? "Scale " : "Current code value "}{shown}</output>
    </div>
    <div className="suggested-actions">
      <button type="button" className="accept" disabled={props.busy || !props.onAcceptSuggestion} title="Expose it as a param of this constraint (no code regeneration)" onClick={() => props.onAcceptSuggestion?.(index)}><Icon name="plus" size={11} />Accept</button>
      <button type="button" disabled={props.busy || !props.onRejectSuggestion} onClick={() => props.onRejectSuggestion?.(index)}>Reject</button>
    </div>
  </article>;
}

/** What of the stack follows the pointer, and the card picked from that list (highlighted until another is picked). */
type PointerView = { links: PointerLink[]; drags: DragLink[]; linked: { constraintId: string; paramId: string } | null };
const PointerContext = createContext<PointerView>({ links: [], drags: [], linked: null });
const pointerName = (link: PointerLink) => POINTER_SOURCES[link.source];
/** The pointer attributes that drive this constraint (`paramId` given: that param; empty: the constraint itself). */
function PointerChips({ constraintId, paramId }: { constraintId: string; paramId: string }) {
  const view = useContext(PointerContext), links = view.links.filter(link => link.constraintId === constraintId && link.paramId === paramId);
  // A value a drag on its object adjusts (with the Adjust tool), dimmed while turned off.
  const drags = paramId ? view.drags.filter(drag => drag.constraintId === constraintId && drag.paramId === paramId) : [];
  if (!links.length && !drags.length) return null;
  return <span className="pointer-chips">{links.map(link => <span key={link.source} className="pointer-chip" title={`${pointerName(link)} → ${link.constraint}${link.param ? ` · ${link.param}` : ""}${link.how ? `: ${link.how}` : ""}`}>
    <Icon name="interaction" size={10} />{pointerName(link)}</span>)}
    {drags.map(drag => <span key={`drag:${drag.dragIndex}`} className={`pointer-chip drag-chip ${drag.off ? "off" : ""}`} title={`${drag.off ? "Off: " : ""}${SOURCE_NAMES[drag.source].name} while dragging the object with the Adjust tool (A) → ${drag.param}${drag.how ? `: ${drag.how}` : ""}`}>
      <Icon name="adjust" size={10} />{SOURCE_NAMES[drag.source].sign} {SOURCE_NAMES[drag.source].name}</span>)}</span>;
}
/**
 * Drag to adjust: every value the mouse's x, y or speed moves while dragging on the drawn object (with the Adjust
 * tool), each one on or off. Turned off, the value is adjusted by its param only; picking one goes to that value in the stack below.
 */
function DragList({ onLink, onOff, editable }: { onLink: (link: { constraintId: string; paramId: string }) => void; onOff?: (constraintId: string, dragIndex: number, off: boolean) => void; editable: boolean }) {
  const { drags, linked } = useContext(PointerContext);
  if (!drags.length) return null;
  return <section className="pointer-list drag-list" aria-label="Drag to adjust">
    <span className="inspector-subtitle">DRAG TO ADJUST · {drags.filter(drag => !drag.off).length}/{drags.length} <small>Adjust tool (A) on the frame</small></span>
    <ul>{drags.map(drag => { const active = linked?.constraintId === drag.constraintId && linked.paramId === drag.paramId;
      return <li key={`${drag.constraintId}:${drag.dragIndex}`} className={drag.off ? "off" : ""}>
        <button type="button" className={active ? "active" : ""} aria-pressed={active} title="Go to the value it adjusts" onClick={() => onLink(drag)}>
          <b className="pointer-source">{SOURCE_NAMES[drag.source].sign} {SOURCE_NAMES[drag.source].name}{drag.invert ? " (reversed)" : ""}</b>
          <Icon name="arrow" size={11} />
          <span className="pointer-target"><span className="constraint-order">{drag.constraintIndex + 1}</span>{drag.constraint}<em> · {drag.param}</em></span>
          {drag.how && <small>{drag.how}</small>}
        </button>
        {onOff && <label className="drag-toggle" title={drag.off ? "Turn the drag on: dragging the object adjusts this value" : "Turn the drag off: adjust this value by its param only"}>
          <input type="checkbox" checked={!drag.off} disabled={!editable} aria-label={`Drag ${drag.param} on the object`} onChange={e => onOff(drag.constraintId, drag.dragIndex, !e.currentTarget.checked)} />{drag.off ? "off" : "on"}</label>}
      </li>; })}</ul>
  </section>;
}
/**
 * Mouse interaction: every pointer attribute the node's constraints read, each with the constraint and the
 * value it is mapped to. Picking one goes to that constraint (and value) in the stack below.
 */
function PointerList({ onLink }: { onLink: (link: PointerLink) => void }) {
  const { links, linked } = useContext(PointerContext);
  if (!links.length) return null;
  return <section className="pointer-list" aria-label="Mouse interaction">
    <span className="inspector-subtitle">MOUSE INTERACTION · {links.length}</span>
    <ul>{links.map(link => { const active = linked?.constraintId === link.constraintId && linked.paramId === link.paramId;
      return <li key={`${link.constraintId}:${link.source}:${link.paramId}`}>
        <button type="button" className={active ? "active" : ""} aria-pressed={active} title="Go to the constraint it is mapped to" onClick={() => onLink(link)}>
          <b className="pointer-source">{pointerName(link)}</b>
          <Icon name="arrow" size={11} />
          <span className="pointer-target"><span className="constraint-order">{link.index + 1}</span>{link.constraint}<em>{link.param ? ` · ${link.param}` : " · the constraint itself"}</em></span>
          {link.how && <small>{link.how}</small>}
        </button>
      </li>; })}</ul>
  </section>;
}

/** One constraint of the stack: its meaning, its params and a socket for more. */
function ConstraintCard({ constraint, index, count, roomInNode, props, openMenu }: { constraint: Constraint; index: number; count: number; roomInNode: boolean; props: ConstraintInspectorProps; openMenu: ReturnType<typeof useContextMenu>[1] }) {
  const { busy } = props, inState = props.state, state = undefined, name = constraint.property || `Constraint ${index + 1}`, { linked } = useContext(PointerContext);
  const states = props.node.machine?.states.filter(item => item.constraintIds.includes(constraint.id)) ?? [];
  return <section className={`constraint-card ${props.highlightConstraintId === constraint.id || (linked?.constraintId === constraint.id && !linked.paramId) ? "inspection-highlight" : ""}`} data-constraint-id={constraint.id} aria-label={`constraint ${name}`}>
    <div className="constraint-heading">
      <span className="constraint-order" title={inState ? `Evaluated ${index + 1}th in ${inState.label}` : "Declaration order"}>{index + 1}</span>
      <input aria-label={`${name} constraint property`} title="The property this constraint controls" maxLength={80} placeholder="e.g. position" value={constraint.property} onChange={e => { const value = e.target.value.trim(); if (value) props.onConstraint(constraint.id, { property: value }); }} />
      {!state && <span className="constraint-tools">
        <button aria-label={`Move ${name} up`} title={inState ? "Evaluate earlier in this state" : "Declare earlier"} disabled={busy || index === 0} onClick={() => props.onMoveConstraint(constraint.id, -1)}>↑</button>
        <button aria-label={`Move ${name} down`} title={inState ? "Evaluate later in this state" : "Declare later"} disabled={busy || index === count - 1} onClick={() => props.onMoveConstraint(constraint.id, 1)}>↓</button>
        {inState && <button aria-label={`Leave ${name} out of ${inState.label}`} title="This state no longer evaluates it (it stays in the node)" disabled={busy} onClick={() => props.onStateConstraint(constraint.id, false)}><Icon name="minus" size={12} /></button>}
        <button aria-label={`Regenerate ${name}`} title="Regenerate this constraint with AI" disabled={busy} onClick={() => props.onRegenerate({ constraintId: constraint.id })}><Icon name="spark" size={12} /></button>
        <button aria-label={`Delete ${name} constraint`} title="Delete constraint and its params" disabled={busy} onClick={() => props.onRemoveConstraint(constraint.id)}><Icon name="close" size={13} /></button>
      </span>}
    </div>
    {props.node.machine && <span className="constraint-states" title="The states that evaluate this constraint">{states.length ? states.map(item => item.label).join(" · ") : "in no state"}</span>}
    <PointerChips constraintId={constraint.id} paramId="" />
    {props.draft && sameTarget(props.draft.target, { constraintId: constraint.id }) && <RegenerateComposer props={props} what={name} />}
    {!state && props.onMinimalExample && <button className="minimal-example-button" disabled={busy || !constraint.params.length} title="Open a new sketch frame that renders only this constraint, to try it in isolation"
      onClick={() => props.onMinimalExample!(constraint.id)}><Icon name="play" size={11} />Create Minimal Example</button>}
    {!state && props.onDesignHandles && constraint.params.some(param => handleLeaves(param).length > 0) && <div className="handle-actions" role="group" aria-label={`${name} direct manipulation handles`}>
      <span><Icon name="target" size={11} />Proxy handles · {constraint.params.filter(param => param.handle).length}/{constraint.params.filter(param => handleLeaves(param).length > 0).length}</span>
      <button type="button" disabled={busy} title="AI makes a direct manipulation interface for each param of this constraint" onClick={() => props.onDesignHandles!({ constraintId: constraint.id })}><Icon name="spark" size={11} />{constraint.params.some(param => param.handle) ? "Redesign with AI" : "Design with AI"}</button>
      {props.onOpenProxy && constraint.params.some(param => param.handle) && <button type="button" onClick={props.onOpenProxy}>Open proxy</button>}
    </div>}
    <textarea aria-label={`${name} constraint description`} placeholder="How the property depends on the other nodes, the input or time" maxLength={1000} rows={2} value={constraint.description} onChange={e => props.onConstraint(constraint.id, { description: e.target.value })} />
    <fieldset disabled={busy} className="param-list">
      {constraint.params.map(param => <ParamCard key={param.id} param={param} props={props} openMenu={openMenu} />)}
      {!state && (props.suggestions ?? []).filter(entry => entry.item.constraintId === constraint.id).map(entry => <SuggestedCard key={`suggested:${entry.item.id}`} item={entry.item} index={entry.index} props={props} />)}
      {!constraint.params.length && !(props.suggestions ?? []).some(entry => entry.item.constraintId === constraint.id) && <p className="empty-panel">No params yet. Drop a block below or regenerate this constraint.</p>}
    </fieldset>
    {!state && roomInNode && constraint.params.length < MAX_PARAMS && <NewSocket library={props.library} busy={busy} onAdd={id => props.onAddParam(id, constraint.id)} onDrop={clip => props.onAddBlock(clip, constraint.id)} />}
  </section>;
}

/** The node's constraints the selected state leaves out, to add to its evaluation order. */
function ExcludedList({ props }: { props: ConstraintInspectorProps }) {
  const state = props.state, shown = new Set(props.constraints.map(item => item.id));
  const rest = state ? props.node.constraints.filter(item => !shown.has(item.id)) : [];
  if (!state || !rest.length) return null;
  return <section className="excluded-constraints" aria-label={`Constraints ${state.label} does not evaluate`}>
    <span className="inspector-subtitle">NOT IN {state.label.toUpperCase()}</span>
    {rest.map(item => <button key={item.id} type="button" disabled={props.busy} title={item.description} onClick={() => props.onStateConstraint(item.id, true)}><Icon name="plus" size={11} />{item.property}</button>)}
  </section>;
}

export function ConstraintInspector(props: ConstraintInspectorProps) {
  const { node, constraints, state, busy } = props;
  const [menu, openMenu] = useContextMenu();
  useEffect(() => { if (props.highlightParamId) document.querySelector(`[data-param-id="${CSS.escape(props.highlightParamId)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [props.highlightParamId]);
  useEffect(() => { if (props.highlightConstraintId) document.querySelector(`[data-constraint-id="${CSS.escape(props.highlightConstraintId)}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" }); }, [props.highlightConstraintId]);
  const [linked, setLinked] = useState<PointerView["linked"]>(null), links = pointerLinks(constraints), drags = dragLinks(node.constraints);
  useEffect(() => setLinked(null), [node.id]);
  // A link of the mouse list goes to the value it is mapped to (or its constraint).
  const goTo = (link: { constraintId: string; paramId: string }) => {
    setLinked({ constraintId: link.constraintId, paramId: link.paramId });
    const selector = link.paramId ? `[data-param-id="${CSS.escape(link.paramId)}"]` : `[data-constraint-id="${CSS.escape(link.constraintId)}"]`;
    requestAnimationFrame(() => document.querySelector(selector)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  };
  const roomInNode = constraints.flatMap(item => item.params).length < MAX_NODE_PARAMS;
  const canStack = node.constraints.length < MAX_CONSTRAINTS;
  return <div className="constraint-inspector">{menu}
    <div className="node-heading"><span className={`node-kind kind-${node.kind}`}><Icon name={node.kind === "collection" ? "collection" : "object"} size={13} />{node.kind === "collection" ? "Brush Stamp" : "Object"}{node.primitive && ` · ${node.primitive}`}</span>
      <input className="node-name-input" aria-label="Node name" maxLength={100} value={node.name} onChange={e => { if (e.target.value.trim()) props.onNode({ name: e.target.value }); }} />
      <textarea aria-label="Node description" maxLength={600} rows={2} value={node.description} onChange={e => props.onNode({ description: e.target.value })} /></div>
    <StateBar {...props} />
    {state && <div className="state-editing-note"><strong>{state.label}</strong> evaluates these constraints in this order, each storing its property before the next. Params are shared by every state.</div>}
    <StateDetails {...props} />
    <PointerContext.Provider value={{ links, drags, linked }}>
    <PointerList onLink={goTo} />
    <DragList onLink={goTo} onOff={props.onDragOff} editable={!busy} />
    <div className="constraint-stack" aria-label="constraints">
      <span className="inspector-subtitle">{state ? `${state.label.toUpperCase()} · EVALUATION ORDER · ${constraints.length}` : `CONSTRAINTS · ${constraints.length}/${MAX_CONSTRAINTS}`}</span>
      {constraints.map((constraint, index) => <ConstraintCard key={constraint.id} constraint={constraint} index={index} count={constraints.length} roomInNode={roomInNode} props={props} openMenu={openMenu} />)}
      {!constraints.length && <p className="empty-panel">{state ? "This state evaluates no constraints." : "No constraints yet. Add one, or let AI propose one."}</p>}
      <ExcludedList props={props} />
    </div>
    </PointerContext.Provider>
    {props.draft && sameTarget(props.draft.target, {}) && <RegenerateComposer props={props} what={node.name} />}
    <div className="inspector-actions">
      {canStack && <button className="copy-button" disabled={busy} title={state ? `A new constraint, evaluated last in ${state.label}` : "A new constraint, in every state"} onClick={props.onAddConstraint}>+ Add constraint</button>}
      {canStack && <button className="alternative-button" disabled={busy} onClick={() => props.onRegenerate({})}><Icon name="spark" size={14} />Add constraint with AI</button>}
      <button className="alternative-button" disabled={busy} onClick={props.onGenerateMachine}><Icon name="grid" size={14} />{node.machine ? "Refine state machine" : "Generate state machine"}</button>
      {node.machine && <button className="copy-button" disabled={busy} onClick={props.onRemoveMachine}>Remove state machine</button>}
      {props.onOpenProxy && <button className="alternative-button" onClick={props.onOpenProxy} title="A frame beside this one with a direct manipulation interface for each param; using it changes this node live"><Icon name="target" size={14} />Open proxy frame</button>}
    </div>
  </div>;
}
