import { useState } from "react";
import type { MachineMark, MachineTarget } from "../../lib/schema";
import type { Scene, SceneNode } from "../../lib/scene/schema";
import { emptyMachineDraft, type MachineDraft } from "../../lib/sketch-panels";
import { machineLayout, machineMarks, machineSnapshotSvg, rasterizeSnapshot, type LayoutOverride } from "../../lib/scene/machine-layout";
import { Icon } from "../icons";
import { MachineGraph, type MachineInspection } from "./machine-graph";

export type MachineRefineRequest = { target: MachineTarget | null; instruction: string; image?: string; marks: MachineMark[] };
type Props = {
  scene: Scene; node: SceneNode | undefined; editingStateId: string | null; runtimeStateId: string | null;
  playing: boolean; busy: boolean; hasCode: boolean;
  /** The picked state/transition (already filtered to this node). */
  target: MachineTarget | null; draft: MachineDraft;
  /** Moved state boxes / transition labels of this node; onLayout(null) restores the automatic layout. */
  layout?: LayoutOverride; onLayout?: (layout: LayoutOverride | null) => void;
  onSelectNode: (id: string) => void; onState: (stateId: string) => void; onTransition: (transitionId: string) => void; onClearTarget: () => void;
  /** Background click: deselect the picked state/transition (and the edited state). */
  onDeselect?: () => void;
  onGenerate: () => void; onDraft: (draft: MachineDraft) => void; onRefine: (request: MachineRefineRequest) => void; onError: (message: string) => void;
  onPlay: (playing: boolean) => void; onRestart: () => void; onEvent: (transitionId: string) => void;
  /** Inspection of a brush: the inspected step's state and transition, and what the inspection is about, are highlighted in the graph. */
  inspected?: MachineInspection | null;
};

/**
 * The state machine of the selected collection/object. Clicking a state jumps
 * the preview there and opens its params; states and transitions can be
 * attached to a refinement, written as text and/or drawn on the graph.
 */
export function NodeMachinePanel(props: Props) {
  const { scene, node, busy } = props;
  const [sending, setSending] = useState(false);
  const owners = scene.nodes.filter(item => item.machine);
  const picker = <select className="machine-node-picker" aria-label="State machine node" value={node?.id || ""} onChange={e => props.onSelectNode(e.target.value)}>
    {!node && <option value="">Choose a brush stamp or object…</option>}
    {scene.nodes.map(item => <option key={item.id} value={item.id}>{item.kind === "collection" ? "▣" : "●"} {item.name}{item.machine ? ` · ${item.machine.states.length} states` : ""}</option>)}
  </select>;
  if (!node?.machine) return <div className="machine-empty"><Icon name="grid" size={24} /><strong>{node ? `${node.name} has no state machine` : "No node selected"}</strong>
    {scene.nodes.length > 0 && picker}
    {node && <button disabled={busy} onClick={props.onGenerate}><Icon name="spark" size={14} />{busy ? "Generating…" : `Generate state machine for ${node.name}`}</button>}
    {owners.length > 0 && <span className="machine-owner-list">With machines: {owners.map(item => <button key={item.id} onClick={() => props.onSelectNode(item.id)}>{item.name}</button>)}</span>}
  </div>;
  const machine = node.machine, runtimeId = props.runtimeStateId || machine.initialState;
  const current = machine.states.find(item => item.id === runtimeId);
  const summary = (stateId: string) => { const count = machine.states.find(state => state.id === stateId)?.constraintIds.length || 0; return `${count} constraint${count === 1 ? "" : "s"}`; };
  const draft = props.draft.nodeId === node.id ? props.draft : emptyMachineDraft(node.id);
  const patch = (next: Partial<MachineDraft>) => props.onDraft({ ...draft, ...next, nodeId: node.id });
  const target = props.target;
  const attached = target?.kind === "state" ? machine.states.find(item => item.id === target.id) : target ? machine.transitions.find(item => item.id === target.id) : undefined;
  const targetName = target?.kind === "state" ? "state" : "transition";
  const refineLabel = attached ? `Refine ${targetName}` : "Refine machine";
  const canSend = !busy && !sending && Boolean(draft.instruction.trim() || draft.strokes.length);
  async function send() {
    if (!canSend || !machine) return;
    setSending(true);
    try {
      const layout = machineLayout(machine, props.layout), focus = attached ? target : null;
      // The graph is always sent so AI sees what was attached, plus the drawing if any.
      const image = await rasterizeSnapshot(machineSnapshotSvg(layout, draft.strokes, focus)).catch(() => undefined);
      props.onRefine({ target: focus, instruction: draft.instruction.trim(), image, marks: machineMarks(layout, draft.strokes) });
    } catch (error) { props.onError(error instanceof Error ? error.message : "Couldn't create the state machine image."); }
    finally { setSending(false); }
  }
  return <div className="state-machine-body node-machine-body">
    <div className="machine-navigation">
      <div className="machine-toolbar">{picker}<div className="machine-live-state"><i />{current?.label}</div><span>{props.playing ? "Playing" : "Paused"}</span>
        <button aria-label={props.playing ? "Pause state machine" : "Play state machine"} title={props.playing ? "Pause" : "Play"} disabled={busy || !props.hasCode} onClick={() => props.onPlay(!props.playing)}><Icon name={props.playing ? "pause" : "play"} size={15} /></button>
        <button aria-label="Restart state machine" title="Restart" disabled={busy || !props.hasCode} onClick={props.onRestart}><Icon name="undo" size={15} /></button>
        {props.layout && (Object.keys(props.layout.states).length > 0 || Object.keys(props.layout.labels).length > 0) && <button className="machine-refine" title="Put states and labels back in the automatic layout" disabled={busy} onClick={() => props.onLayout?.(null)}><Icon name="grid" size={13} />Auto layout</button>}
        <button className={`machine-refine ${draft.annotating ? "machine-annotating" : ""}`} aria-pressed={draft.annotating} title="Draw on the state machine (used when refining)" disabled={busy} onClick={() => patch({ annotating: !draft.annotating })}>
          <Icon name="pen" size={13} />{draft.annotating ? "Done" : "Annotate"}{draft.strokes.length > 0 && ` · ${draft.strokes.length}`}</button>
        <button className="machine-refine" aria-expanded={draft.open} title="Describe how to change the attached state/transition" disabled={busy} onClick={() => patch({ open: true })}><Icon name="spark" size={13} />{refineLabel}</button>
      </div>
      {props.inspected && (() => { const inspected = props.inspected, label = (id: string | null) => machine.states.find(item => item.id === id)?.label ?? id;
        const via = inspected.transition ? machine.transitions.find(item => item.id === inspected.transition)?.label : null;
        return <div className="machine-inspection-legend" role="note" aria-label="Inspection highlight">
          {inspected.state && <span><i className="now" />This step: {inspected.from && inspected.from !== inspected.state ? `${label(inspected.from)} → ` : ""}<b>{label(inspected.state)}</b>{via ? ` (${via})` : ""}</span>}
          {(inspected.states.length > 0 || inspected.transitions.length > 0) && <span><i className="related" />Related to inspection: {[...inspected.states.map(label), ...inspected.transitions.map(id => machine.transitions.find(item => item.id === id)?.label ?? id)].join(", ")}</span>}
        </div>; })()}
      <MachineGraph key={node.id} machine={machine} inspected={props.inspected} selectedId={props.editingStateId} target={attached ? target : null} runtimeId={runtimeId} busy={busy} annotating={draft.annotating} strokes={draft.strokes} layout={props.layout}
        onMoveState={(id, point) => props.onLayout?.({ states: { ...props.layout?.states, [id]: point }, labels: { ...props.layout?.labels } })}
        onMoveLabel={(id, offset) => props.onLayout?.({ states: { ...props.layout?.states }, labels: { ...props.layout?.labels, [id]: offset } })}
        onState={props.onState} onTransition={props.onTransition} onBackground={props.onDeselect || props.onClearTarget} onStroke={stroke => patch({ strokes: [...draft.strokes, stroke].slice(-64) })} summary={summary} />
      {draft.open && <form className="machine-refine-composer" aria-label="Refine state machine" onSubmit={e => { e.preventDefault(); void send(); }}>
        <div className="machine-refine-attachments">
          {attached ? <span className="machine-attachment" title={target?.kind === "transition" && "from" in attached ? `${machine.states.find(s => s.id === attached.from)?.label} → ${machine.states.find(s => s.id === attached.to)?.label}` : attached.id}>
            <Icon name={target?.kind === "state" ? "grid" : "arrow"} size={12} /><b>{target?.kind === "state" ? "State" : "Transition"}</b>{attached.label} attached
            <button type="button" aria-label="Detach" title="Detach (refine the whole state machine)" onClick={props.onClearTarget}><Icon name="close" size={11} /></button></span>
            : <span className="machine-attachment machine-attachment-empty">Nothing attached · refines the whole state machine (click a state/transition in the graph to attach)</span>}
          {draft.strokes.length > 0 && <span className="machine-attachment machine-attachment-annotation"><Icon name="pen" size={12} /><b>Annotation</b>{draft.strokes.length} stroke{draft.strokes.length === 1 ? "" : "s"} attached
            <button type="button" aria-label="Clear annotation" title="Clear annotation" onClick={() => patch({ strokes: [] })}><Icon name="close" size={11} /></button></span>}
        </div>
        <textarea autoFocus aria-label="How to refine" value={draft.instruction} maxLength={2000} rows={3} placeholder={attached ? `Describe how to change this ${targetName}. e.g. on release, bounce back to its original spot over 0.5s` : "Describe how to change the state machine. Drawing only an annotation is fine too."}
          onChange={e => patch({ instruction: e.target.value })} onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } if (e.key === "Escape") patch({ open: false }); }} />
        <div className="machine-refine-actions"><span>{draft.annotating ? "The annotation drawn on the graph is sent too." : "⌘/Ctrl+Enter to send"}</span>
          <button type="button" onClick={() => patch({ open: false })}>Cancel</button>
          <button type="submit" className="primary" disabled={!canSend}><Icon name="spark" size={13} />{sending || busy ? "Refining…" : refineLabel}</button></div>
      </form>}
      <div className="machine-events">{machine.transitions.filter(transition => transition.from === runtimeId).map(transition => <button key={transition.id} disabled={busy || !props.hasCode} onClick={() => props.onEvent(transition.id)}><Icon name="play" size={12} />{transition.label}<Icon name="arrow" size={12} /></button>)}</div>
    </div>
  </div>;
}
