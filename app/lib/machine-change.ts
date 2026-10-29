import { z } from "zod";
import { moduleKeyOf } from "./hidden-parameters";
import { findNode } from "./scene/graph";
import { sceneInstances } from "./scene/machines";
import { MAX_NODE_STATES, MAX_NODE_TRANSITIONS, type NodeMachine, type Scene } from "./scene/schema";

// A recommendation that makes the brush react to something it meets while running (things touching, overlapping,
// a limit reached) changes its behavior, and the brush's behavior is its state machine: the preview code says so
// by emitting a transition (m.emit) when that happens, and brings the states and transitions it emits with it.
// The fork made from it (and the exploration frames running it) have them in their machine, so the change shows
// in the state machine panel and each time it happens is a recorded step of the inspection.

const ID = /^[a-z0-9][a-z0-9-]*$/;
export const machineChangeSchema = z.object({
  /** The node whose machine changes (one of the brush's nodes). */
  nodeId: z.string().max(80),
  /** New states, each starting with the values of an existing state (`like`; "" for none). */
  states: z.array(z.object({ id: z.string().max(60), label: z.string().min(1).max(100), description: z.string().max(400), like: z.string().max(60) })).max(3),
  /** New transitions: an "event" one is emitted by the preview code (m.emit) when the condition happens; an "after" one follows on its own. */
  transitions: z.array(z.object({ id: z.string().max(60), from: z.string().max(60), to: z.string().max(60), label: z.string().min(1).max(100),
    trigger: z.enum(["after", "event"]), afterMs: z.number().int().min(100).max(60000) })).max(4),
});
export type MachineChange = z.infer<typeof machineChangeSchema>;

/**
 * The part of a machine change that can be kept for this scene and these edits (null: none): new ids that are free,
 * transitions between states that exist (or come with it), and an "event" transition only when the edits emit it.
 */
export function cleanMachineChange(scene: Scene, change: MachineChange | null | undefined, edits: { nodeId: string; replace: string }[]): MachineChange | null {
  const node = change && findNode(scene, change.nodeId);
  if (!change || !node) return null;
  const machine = node.machine, taken = new Set([...(machine?.states ?? []).map(state => state.id), ...(machine?.transitions ?? []).map(item => item.id)]);
  const states = change.states.filter((state, i, all) => ID.test(state.id) && !taken.has(state.id) && all.findIndex(other => other.id === state.id) === i)
    .slice(0, Math.max(0, MAX_NODE_STATES - (machine?.states.length ?? 0)));
  if (!machine && !states.length) return null;
  const known = new Set([...(machine?.states ?? []).map(state => state.id), ...states.map(state => state.id)]);
  const code = edits.map(edit => edit.replace).join("\n");
  const emitted = (id: string) => /m\.emit\s*\(/.test(code) && (code.includes(`"${id}"`) || code.includes(`'${id}'`) || code.includes(`\`${id}\``));
  const transitions = change.transitions.filter((item, i, all) => ID.test(item.id) && !taken.has(item.id) && !known.has(item.id) && all.findIndex(other => other.id === item.id) === i
    && known.has(item.from) && known.has(item.to) && (item.trigger === "after" || emitted(item.id)))
    .slice(0, Math.max(0, MAX_NODE_TRANSITIONS - (machine?.transitions.length ?? 0)));
  // A new state nothing goes to is not part of the behavior.
  const reached = states.filter(state => !machine || transitions.some(item => item.to === state.id));
  const kept = transitions.filter(item => [...(machine?.states ?? []), ...reached].some(state => state.id === item.from) && [...(machine?.states ?? []), ...reached].some(state => state.id === item.to));
  return kept.length || (!machine && reached.length) ? { ...change, states: reached, transitions: kept } : null;
}

/** The machine with the change in (a node without one gets one, starting in the first new state). */
function changedMachine(machine: NodeMachine | null, change: MachineChange): NodeMachine {
  const base: NodeMachine = machine ?? { initialState: change.states[0].id, states: [], transitions: [] };
  const valuesOf = (like: string) => base.states.find(state => state.id === like)?.values ?? [];
  return { ...base,
    states: [...base.states, ...change.states.map(state => ({ id: state.id, label: state.label, description: state.description, values: valuesOf(state.like) }))],
    transitions: [...base.transitions, ...change.transitions.map(({ id, from, to, label, trigger, afterMs }) => ({ id, from, to, label, trigger, afterMs }))] };
}

/** The scene with a (clean) machine change on its node and on every stamp running the same module. */
export function applyMachineChange(scene: Scene, change: MachineChange | null | undefined): Scene {
  const node = change && findNode(scene, change.nodeId);
  if (!change || !node) return scene;
  const codeId = node.codeId ?? node.id, module = moduleKeyOf(scene, node.id);
  const ids = new Set([node.id, ...sceneInstances(scene).filter(instance => instance.module === module).map(instance => instance.map[codeId]).filter(Boolean)]);
  return { ...scene, nodes: scene.nodes.map(item => ids.has(item.id) ? { ...item, machine: changedMachine(item.machine, change) } : item) };
}
