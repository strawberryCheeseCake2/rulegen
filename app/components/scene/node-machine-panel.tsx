import type { Scene, SceneNode } from "../../lib/scene/schema";
import { Icon } from "../icons";
import { MachineGraph } from "./machine-graph";

type Props = {
  scene: Scene; node: SceneNode | undefined; editingStateId: string | null; runtimeStateId: string | null;
  playing: boolean; busy: boolean; hasCode: boolean;
  onSelectNode: (id: string) => void; onState: (stateId: string) => void; onGenerate: () => void;
  onPlay: (playing: boolean) => void; onRestart: () => void; onEvent: (transitionId: string) => void;
};

/**
 * The state machine of the selected collection/object. Clicking a state jumps
 * the preview there and opens that state's properties in the right inspector.
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
    {node && <button disabled={busy} onClick={props.onGenerate}><Icon name="spark" size={14} />{busy ? "Generating…" : `Generate state machine for ${node.name}`}</button>}
    {owners.length > 0 && <span className="machine-owner-list">With machines: {owners.map(item => <button key={item.id} onClick={() => props.onSelectNode(item.id)}>{item.name}</button>)}</span>}
  </div>;
  const machine = node.machine, runtimeId = props.runtimeStateId || machine.initialState;
  const current = machine.states.find(item => item.id === runtimeId);
  const summary = (stateId: string) => { const count = machine.states.find(state => state.id === stateId)?.values.length || 0; return `${count} propert${count === 1 ? "y" : "ies"} changed`; };
  return <div className="state-machine-body node-machine-body">
    <div className="machine-navigation">
      <div className="machine-toolbar">{picker}<div className="machine-live-state"><i />{current?.label}</div><span>{props.playing ? "Playing" : "Paused"}</span>
        <button aria-label={props.playing ? "Pause state machine" : "Play state machine"} title={props.playing ? "Pause" : "Play"} disabled={busy || !props.hasCode} onClick={() => props.onPlay(!props.playing)}><Icon name={props.playing ? "pause" : "play"} size={15} /></button>
        <button aria-label="Restart state machine" title="Restart" disabled={busy || !props.hasCode} onClick={props.onRestart}><Icon name="undo" size={15} /></button>
        <button className="machine-refine" aria-label="Generate detailed state machine" title="Regenerate with detailed states" disabled={busy} onClick={props.onGenerate}><Icon name="spark" size={13} />Refine states</button>
      </div>
      <MachineGraph machine={machine} selectedId={props.editingStateId} runtimeId={runtimeId} busy={busy} onState={props.onState} summary={summary} />
      <div className="machine-events">{machine.transitions.filter(transition => transition.from === runtimeId && transition.trigger === "event").map(transition => <button key={transition.id} disabled={busy || !props.hasCode} onClick={() => props.onEvent(transition.id)}><Icon name="play" size={12} />{transition.label}<Icon name="arrow" size={12} /></button>)}</div>
    </div>
  </div>;
}
