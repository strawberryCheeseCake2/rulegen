import type { Scene, SceneNode } from "../../lib/scene/schema";
import type { LayoutOverride } from "../../lib/scene/machine-layout";
import { Icon } from "../icons";
import { MachineGraph, type MachineTarget } from "./machine-graph";

type Props = {
  scene: Scene; node: SceneNode | undefined; editingStateId: string | null; runtimeStateId: string | null;
  playing: boolean; busy: boolean; hasCode: boolean;
  /** The picked state/transition (already filtered to this node). */
  target: MachineTarget | null;
  /** Moved state boxes / transition labels of this node; onLayout(null) restores the automatic layout. */
  layout?: LayoutOverride; onLayout?: (layout: LayoutOverride | null) => void;
  onSelectNode: (id: string) => void; onState: (stateId: string) => void; onTransition: (transitionId: string) => void; onClearTarget: () => void;
  /** Background click: deselect the picked state/transition (and the edited state). */
  onDeselect?: () => void;
  onPlay: (playing: boolean) => void; onRestart: () => void; onEvent: (transitionId: string) => void;
};

/**
 * The state machine of the selected collection/object (a composition gets one
 * from interaction marks). Clicking a state jumps the preview there and opens
 * its properties; event transitions can be fired from here.
 */
export function NodeMachinePanel(props: Props) {
  const { scene, node, busy } = props;
  const owners = scene.nodes.filter(item => item.machine);
  const picker = <select className="machine-node-picker" aria-label="State machine node" value={node?.id || ""} onChange={e => props.onSelectNode(e.target.value)}>
    {!node && <option value="">Choose a collection or object…</option>}
    {scene.nodes.map(item => <option key={item.id} value={item.id}>{item.kind === "collection" ? "▣" : "●"} {item.name}{item.machine ? ` · ${item.machine.states.length} states` : ""}</option>)}
  </select>;
  if (!node?.machine) return <div className="machine-empty"><Icon name="grid" size={24} /><strong>{node ? `${node.name} has no state machine` : "No node selected"}</strong>
    {scene.nodes.length > 0 && picker}
    {owners.length > 0 && <span className="machine-owner-list">With machines: {owners.map(item => <button key={item.id} onClick={() => props.onSelectNode(item.id)}>{item.name}</button>)}</span>}
  </div>;
  const machine = node.machine, runtimeId = props.runtimeStateId || machine.initialState;
  const current = machine.states.find(item => item.id === runtimeId);
  const summary = (stateId: string) => { const count = machine.states.find(state => state.id === stateId)?.values.length || 0; return `${count} propert${count === 1 ? "y" : "ies"} changed`; };
  const target = props.target, attached = target && (target.kind === "state" ? machine.states : machine.transitions).some(item => item.id === target.id) ? target : null;
  return <div className="state-machine-body node-machine-body">
    <div className="machine-navigation">
      <div className="machine-toolbar">{picker}<div className="machine-live-state"><i />{current?.label}</div><span>{props.playing ? "Playing" : "Paused"}</span>
        <button aria-label={props.playing ? "Pause state machine" : "Play state machine"} title={props.playing ? "Pause" : "Play"} disabled={busy || !props.hasCode} onClick={() => props.onPlay(!props.playing)}><Icon name={props.playing ? "pause" : "play"} size={15} /></button>
        <button aria-label="Restart state machine" title="Restart" disabled={busy || !props.hasCode} onClick={props.onRestart}><Icon name="undo" size={15} /></button>
        {props.layout && (Object.keys(props.layout.states).length > 0 || Object.keys(props.layout.labels).length > 0) && <button className="machine-refine" title="Put states and labels back in the automatic layout" disabled={busy} onClick={() => props.onLayout?.(null)}><Icon name="grid" size={13} />Auto layout</button>}
      </div>
      <MachineGraph key={node.id} machine={machine} selectedId={props.editingStateId} target={attached} runtimeId={runtimeId} busy={busy} annotating={false} strokes={[]} layout={props.layout}
        onMoveState={(id, point) => props.onLayout?.({ states: { ...props.layout?.states, [id]: point }, labels: { ...props.layout?.labels } })}
        onMoveLabel={(id, offset) => props.onLayout?.({ states: { ...props.layout?.states }, labels: { ...props.layout?.labels, [id]: offset } })}
        onState={props.onState} onTransition={props.onTransition} onBackground={props.onDeselect || props.onClearTarget} onStroke={() => {}} summary={summary} />
      <div className="machine-events">{machine.transitions.filter(transition => transition.from === runtimeId && transition.trigger === "event").map(transition => <button key={transition.id} disabled={busy || !props.hasCode} onClick={() => props.onEvent(transition.id)}><Icon name="play" size={12} />{transition.label}<Icon name="arrow" size={12} /></button>)}</div>
    </div>
  </div>;
}
