import type { SketchPanel } from "../sketch-panels";
import type { NodeState, NodeTransition, Param, Scene, SceneNode, ScalarValue, Constraint, Value } from "./schema";
import { MAX_NODE_PARAMS, MAX_CONSTRAINTS } from "./schema";
import { findAlgorithm, instantiate, sceneAlgorithmUsage } from "./algorithms";
import { findNode, updateNode } from "./graph";
import { conformMachine, setStateConstraint, stateConstraints } from "./machines";
import * as layers from "./constraints";
import { relinkStamps } from "./live";
import { defaultNumber, isAlgorithm, replaceAt, setScalarAt, valueAt } from "./values";

// Pure SketchPanel → patch helpers used by the route. Structural edits are undoable;
// widget drags are not (they are frequent and immediately visible).

type Patch = Partial<SketchPanel>;
const HISTORY = 40;

function tidy(panel: SketchPanel, scene: Scene): Patch {
  const ids = new Set(scene.nodes.map(node => node.id)), generated = relinkStamps(panel.generated, panel.scene, scene);
  return {
    ...(generated !== panel.generated ? { generated } : {}),
    scene: { ...scene, nodes: scene.nodes.map(conformMachine) },
    selectedNodeIds: panel.selectedNodeIds.filter(id => ids.has(id)),
    editingStates: Object.fromEntries(Object.entries(panel.editingStates).filter(([nodeId, stateId]) => findNode(scene, nodeId)?.machine?.states.some(state => state.id === stateId))),
  };
}
export function commitScene(panel: SketchPanel, scene: Scene, dirty: string[] = []): Patch {
  if (scene === panel.scene) return {};
  return { ...tidy(panel, scene), sceneHistory: [...panel.sceneHistory.slice(-(HISTORY - 1)), panel.scene], sceneFuture: [], dirtyNodeIds: [...new Set([...panel.dirtyNodeIds, ...dirty])] };
}
/** Finish a live edit (e.g. a drag): one undo entry from where it started. */
export function commitSceneFrom(panel: SketchPanel, before: Scene, scene: Scene, dirty: string[] = []): Patch {
  return { ...tidy(panel, scene), sceneHistory: [...panel.sceneHistory.slice(-(HISTORY - 1)), before], sceneFuture: [], dirtyNodeIds: [...new Set([...panel.dirtyNodeIds, ...dirty])] };
}
/** Replace the scene without an undo entry (widget drags, AI results that reset history). */
export function setScene(panel: SketchPanel, scene: Scene, dirty: string[] = []): Patch {
  return { ...tidy(panel, scene), dirtyNodeIds: [...new Set([...panel.dirtyNodeIds, ...dirty])] };
}
export function undoScene(panel: SketchPanel): Patch {
  const previous = panel.sceneHistory[panel.sceneHistory.length - 1];
  return previous ? { ...tidy(panel, previous), sceneHistory: panel.sceneHistory.slice(0, -1), sceneFuture: [...panel.sceneFuture, panel.scene] } : {};
}
export function redoScene(panel: SketchPanel): Patch {
  const next = panel.sceneFuture[panel.sceneFuture.length - 1];
  return next ? { ...tidy(panel, next), sceneFuture: panel.sceneFuture.slice(0, -1), sceneHistory: [...panel.sceneHistory, panel.scene] } : {};
}

export function selectNodes(panel: SketchPanel, id: string | null, additive = false): Patch {
  if (!id) return { selectedNodeIds: [] };
  if (!additive) return { selectedNodeIds: [id] };
  return { selectedNodeIds: panel.selectedNodeIds.includes(id) ? panel.selectedNodeIds.filter(item => item !== id) : [...panel.selectedNodeIds, id] };
}
export const inspectedNode = (panel: SketchPanel) => findNode(panel.scene, panel.selectedNodeIds[0]);
export function editingState(panel: SketchPanel, node: SceneNode | undefined): NodeState | undefined {
  const id = node && panel.editingStates[node.id];
  return node?.machine?.states.find(state => state.id === id);
}
/** The constraints the inspector shows: the selected state's, in its evaluation order; without one, all of the node's. */
export function inspectedConstraints(panel: SketchPanel, node: SceneNode): Constraint[] {
  return stateConstraints(node, panel.editingStates[node.id]);
}
/** The params of the constraints the inspector shows. */
export const inspectedParams = (panel: SketchPanel, node: SceneNode): Param[] => inspectedConstraints(panel, node).flatMap(constraint => constraint.params);
export function chooseState(panel: SketchPanel, nodeId: string, stateId: string | null): Patch {
  const editingStates = { ...panel.editingStates };
  if (stateId) editingStates[nodeId] = stateId; else delete editingStates[nodeId];
  return { editingStates, selectedNodeIds: [nodeId], stateJump: stateId ? { nodeId, stateId, revision: (panel.stateJump?.revision || 0) + 1 } : panel.stateJump };
}

/** Slider / color / select / toggle edit of a param (a constraint is the same in every state that evaluates it). */
export function setParamScalar(panel: SketchPanel, nodeId: string, paramId: string, path: string[], raw: ScalarValue["value"]): Patch {
  const node = findNode(panel.scene, nodeId);
  const param = node && layers.findParam(node, paramId);
  if (!node || !param) return {};
  const value = setScalarAt(param.value, path, raw);
  return { scene: updateNode(panel.scene, nodeId, item => layers.updateParam(item, paramId, p => ({ ...p, value }))) };
}

export type SlotChoice = { type: "number" } | { type: "algorithm"; algorithmId: string };
/** Swap a slot between a number and an algorithm (structural: applies to the base and every state). */
export function swapSlot(panel: SketchPanel, nodeId: string, paramId: string, path: string[], choice: SlotChoice): Patch {
  const node = findNode(panel.scene, nodeId);
  const param = node && layers.findParam(node, paramId);
  if (!node || !param) return {};
  const current = valueAt(param.value, path);
  if (!current || (choice.type === "algorithm" && isAlgorithm(current) && current.algorithmId === choice.algorithmId) || (choice.type === "number" && current.type === "number")) return {};
  const replacement: Value = choice.type === "number" ? defaultNumber() : instantiate(panel.scene.algorithms, choice.algorithmId, path.length + 1);
  const value = replaceAt(param.value, path, () => replacement);
  return commitScene(panel, updateNode(panel.scene, nodeId, item => layers.updateParam(item, paramId, p => ({ ...p, value }))), [nodeId]);
}

export function editNode(panel: SketchPanel, nodeId: string, patch: Partial<Pick<SceneNode, "name" | "description" | "visible">>, history = false): Patch {
  const scene = updateNode(panel.scene, nodeId, node => ({ ...node, ...patch }));
  const semantic = patch.description !== undefined;
  return history ? commitScene(panel, scene, semantic ? [nodeId] : []) : setScene(panel, scene, semantic ? [nodeId] : []);
}
export function editParam(panel: SketchPanel, nodeId: string, paramId: string, patch: Partial<Pick<Param, "label" | "description" | "effect">>): Patch {
  return setScene(panel, updateNode(panel.scene, nodeId, node => layers.updateParam(node, paramId, p => ({ ...p, ...patch }))), [nodeId]);
}
export function removeParam(panel: SketchPanel, nodeId: string, paramId: string): Patch {
  return commitScene(panel, updateNode(panel.scene, nodeId, node => layers.mapParams(node, p => p.id === paramId ? null : p)), [nodeId]);
}
/** A param holding a library block, in `constraintId` (or the last one with room / a new one). */
export function addAlgorithmParam(panel: SketchPanel, nodeId: string, algorithmId: string, constraintId?: string | null): Patch {
  const node = findNode(panel.scene, nodeId), algorithm = findAlgorithm(panel.scene.algorithms, algorithmId);
  if (!node || !algorithm || !layers.canAddParam(node, constraintId)) return {};
  const param: Param = { id: algorithm.id.slice(0, 70), label: algorithm.name.slice(0, 80), effect: "spatial", description: algorithm.description.slice(0, 600), value: instantiate(panel.scene.algorithms, algorithmId) };
  const next = layers.appendParam(node, param, constraintId, algorithm.name).node;
  return commitScene(panel, updateNode(panel.scene, nodeId, () => next), [nodeId]);
}

// ── Constraints ───────────────────────────────────────────────────────────────
/** A new constraint: into the selected state (at the end of its order), or, with none selected, into every state. */
export function addConstraint(panel: SketchPanel, nodeId: string, property = "property"): Patch {
  const node = findNode(panel.scene, nodeId);
  if (!node || !layers.canAddConstraint(node)) return {};
  return commitScene(panel, updateNode(panel.scene, nodeId, item => layers.addConstraint(item, { property }, { stateId: panel.editingStates[nodeId] }).node), [nodeId]);
}
export function editConstraint(panel: SketchPanel, nodeId: string, constraintId: string, patch: Partial<Pick<Constraint, "property" | "description">>): Patch {
  return setScene(panel, updateNode(panel.scene, nodeId, node => layers.updateConstraint(node, constraintId, item => ({ ...item, ...patch }))), [nodeId]);
}
export function removeConstraint(panel: SketchPanel, nodeId: string, constraintId: string): Patch {
  return commitScene(panel, updateNode(panel.scene, nodeId, node => layers.removeConstraint(node, constraintId)), [nodeId]);
}
/** Reorder: in the selected state's evaluation order (host data, live), else in the node's declaration order. */
export function moveConstraint(panel: SketchPanel, nodeId: string, constraintId: string, offset: number): Patch {
  return commitScene(panel, updateNode(panel.scene, nodeId, node => layers.moveConstraint(node, constraintId, offset, panel.editingStates[nodeId])));
}
/** Whether a state evaluates a constraint (host data, live: no new code). */
export function setStateConstraintIncluded(panel: SketchPanel, nodeId: string, stateId: string, constraintId: string, included: boolean): Patch {
  return commitScene(panel, updateNode(panel.scene, nodeId, node => setStateConstraint(node, stateId, constraintId, included)));
}
/**
 * Drag and drop in Layers: a constraint put before `beforeId` in `toNodeId` (none: at its end), in its own
 * node (a reorder) or another one (it leaves the first and joins every state of the other). {} when nothing changes; an error when there is no room.
 */
export function relocateConstraint(panel: SketchPanel, fromNodeId: string, constraintId: string, toNodeId: string, beforeId: string | null): Patch {
  const source = findNode(panel.scene, fromNodeId), target = findNode(panel.scene, toNodeId), moved = source && layers.findConstraint(source, constraintId);
  if (!source || !target || !moved || beforeId === constraintId) return {};
  if (source.id === target.id) {
    const rest = source.constraints.filter(item => item.id !== constraintId), at = rest.findIndex(item => item.id === beforeId);
    const constraints = [...rest]; constraints.splice(at < 0 ? rest.length : at, 0, moved);
    if (constraints.every((item, i) => item.id === source.constraints[i].id)) return {};
    return commitScene(panel, updateNode(panel.scene, source.id, node => ({ ...node, constraints })), [source.id]);
  }
  if (!layers.canTakeConstraint(target, moved)) return { error: `“${target.name}” has no room for “${moved.property || moved.id}” (at most ${MAX_CONSTRAINTS} constraints and ${MAX_NODE_PARAMS} params a node).` };
  const left = updateNode(panel.scene, source.id, node => layers.removeConstraint(node, constraintId));
  return commitScene(panel, updateNode(left, target.id, node => layers.takeConstraint(node, moved, beforeId)), [source.id, target.id]);
}

/** Algorithm definitions are shared: editing one marks every node that uses it. */
export function editAlgorithm(panel: SketchPanel, algorithmId: string, patch: { name?: string; description?: string }): Patch {
  const users = sceneAlgorithmUsage(panel.scene).get(algorithmId)?.map(use => use.nodeId) || [];
  return setScene(panel, { ...panel.scene, algorithms: panel.scene.algorithms.map(item => item.id === algorithmId ? { ...item, ...patch } : item) }, users);
}

export function editMachineState(panel: SketchPanel, nodeId: string, stateId: string, patch: Partial<Pick<NodeState, "label" | "description">>): Patch {
  return setScene(panel, updateNode(panel.scene, nodeId, node => node.machine ? { ...node, machine: { ...node.machine, states: node.machine.states.map(state => state.id === stateId ? { ...state, ...patch } : state) } } : node), patch.description !== undefined ? [nodeId] : []);
}
/** Labels and targets are live in the host block; a new event name is new code (the code dispatches it). */
export function editTransition(panel: SketchPanel, nodeId: string, transitionId: string, patch: Partial<Pick<NodeTransition, "label" | "event" | "to">>): Patch {
  return setScene(panel, updateNode(panel.scene, nodeId, node => node.machine ? { ...node, machine: { ...node.machine, transitions: node.machine.transitions.map(t => t.id === transitionId ? { ...t, ...patch } : t) } } : node), patch.event !== undefined ? [nodeId] : []);
}
export function removeMachine(panel: SketchPanel, nodeId: string): Patch {
  const editingStates = { ...panel.editingStates }; delete editingStates[nodeId];
  return { ...commitScene(panel, updateNode(panel.scene, nodeId, node => ({ ...node, machine: null })), [nodeId]), editingStates };
}
