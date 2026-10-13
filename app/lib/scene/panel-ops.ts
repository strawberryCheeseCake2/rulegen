import type { SketchPanel } from "../sketch-panels";
import type { NodeState, NodeTransition, Property, Scene, SceneNode, ScalarValue, SemanticTransformation, Value } from "./schema";
import { findAlgorithm, instantiate, sceneAlgorithmUsage } from "./algorithms";
import { findNode, updateNode } from "./graph";
import { conformMachine, setStateValue, stateProperties, stateTransformations } from "./machines";
import * as layers from "./transformations";
import { defaultNumber, isAlgorithm, replaceAt, setScalarAt, valueAt } from "./values";

// Pure SketchPanel → patch helpers used by the route. Structural edits are undoable;
// widget drags are not (they are frequent and immediately visible).

type Patch = Partial<SketchPanel>;
const HISTORY = 40;

function tidy(panel: SketchPanel, scene: Scene): Patch {
  const ids = new Set(scene.nodes.map(node => node.id));
  return {
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
/** Properties the inspector shows: the edited state's values when a state is selected. */
export function inspectedProperties(panel: SketchPanel, node: SceneNode): Property[] {
  return stateProperties(node, panel.editingStates[node.id]);
}
/** The node's transformation stack as the inspector shows it (state values applied). */
export function inspectedTransformations(panel: SketchPanel, node: SceneNode): SemanticTransformation[] {
  return stateTransformations(node, panel.editingStates[node.id]);
}
export function chooseState(panel: SketchPanel, nodeId: string, stateId: string | null): Patch {
  const editingStates = { ...panel.editingStates };
  if (stateId) editingStates[nodeId] = stateId; else delete editingStates[nodeId];
  return { editingStates, selectedNodeIds: [nodeId], stateJump: stateId ? { nodeId, stateId, revision: (panel.stateJump?.revision || 0) + 1 } : panel.stateJump };
}

/** Slider / color / select / toggle edit. Goes to the edited state when one is selected. */
export function setPropertyScalar(panel: SketchPanel, nodeId: string, propertyId: string, path: string[], raw: ScalarValue["value"]): Patch {
  const node = findNode(panel.scene, nodeId);
  const property = node && inspectedProperties(panel, node).find(item => item.id === propertyId);
  if (!node || !property) return {};
  const value = setScalarAt(property.value, path, raw);
  const stateId = panel.editingStates[nodeId];
  const next = stateId ? setStateValue(node, stateId, propertyId, value) : layers.updateProperty(node, propertyId, item => ({ ...item, value }));
  return { scene: updateNode(panel.scene, nodeId, () => next) };
}

export type SlotChoice = { type: "number" } | { type: "algorithm"; algorithmId: string };
/** Swap a slot between a number and an algorithm (structural: applies to the base and every state). */
export function swapSlot(panel: SketchPanel, nodeId: string, propertyId: string, path: string[], choice: SlotChoice): Patch {
  const node = findNode(panel.scene, nodeId);
  const property = node && layers.findProperty(node, propertyId);
  if (!node || !property) return {};
  const current = valueAt(property.value, path);
  if (!current || (choice.type === "algorithm" && isAlgorithm(current) && current.algorithmId === choice.algorithmId) || (choice.type === "number" && current.type === "number")) return {};
  const replacement: Value = choice.type === "number" ? defaultNumber() : instantiate(panel.scene.algorithms, choice.algorithmId, path.length + 1);
  const value = replaceAt(property.value, path, () => replacement);
  return commitScene(panel, updateNode(panel.scene, nodeId, item => layers.updateProperty(item, propertyId, p => ({ ...p, value }))), [nodeId]);
}

export function editNode(panel: SketchPanel, nodeId: string, patch: Partial<Pick<SceneNode, "name" | "description" | "visible">>, history = false): Patch {
  const scene = updateNode(panel.scene, nodeId, node => ({ ...node, ...patch }));
  const semantic = patch.description !== undefined;
  return history ? commitScene(panel, scene, semantic ? [nodeId] : []) : setScene(panel, scene, semantic ? [nodeId] : []);
}
export function editProperty(panel: SketchPanel, nodeId: string, propertyId: string, patch: Partial<Pick<Property, "label" | "description" | "effect">>): Patch {
  return setScene(panel, updateNode(panel.scene, nodeId, node => layers.updateProperty(node, propertyId, p => ({ ...p, ...patch }))), [nodeId]);
}
export function removeProperty(panel: SketchPanel, nodeId: string, propertyId: string): Patch {
  return commitScene(panel, updateNode(panel.scene, nodeId, node => ({ ...layers.mapProperties(node, p => p.id === propertyId ? null : p),
    machine: node.machine && { ...node.machine, states: node.machine.states.map(state => ({ ...state, values: state.values.filter(item => item.propertyId !== propertyId) })) } })), [nodeId]);
}
/** A property holding a library block, in `transformationId` (or the last one with room / a new one). */
export function addAlgorithmProperty(panel: SketchPanel, nodeId: string, algorithmId: string, transformationId?: string | null): Patch {
  const node = findNode(panel.scene, nodeId), algorithm = findAlgorithm(panel.scene.algorithms, algorithmId);
  if (!node || !algorithm || !layers.canAddProperty(node, transformationId)) return {};
  const property: Property = { id: algorithm.id.slice(0, 70), label: algorithm.name.slice(0, 80), effect: "spatial", description: algorithm.description.slice(0, 600), value: instantiate(panel.scene.algorithms, algorithmId) };
  const next = layers.appendProperty(node, property, transformationId, algorithm.name).node;
  return commitScene(panel, updateNode(panel.scene, nodeId, () => next), [nodeId]);
}

// ── Semantic transformation stack ─────────────────────────────────────────────
export function addTransformation(panel: SketchPanel, nodeId: string, label = "New transformation"): Patch {
  const node = findNode(panel.scene, nodeId);
  if (!node || !layers.canAddTransformation(node)) return {};
  return commitScene(panel, updateNode(panel.scene, nodeId, item => layers.addTransformation(item, { label }).node), [nodeId]);
}
export function editTransformation(panel: SketchPanel, nodeId: string, transformationId: string, patch: Partial<Pick<SemanticTransformation, "label" | "description">>): Patch {
  return setScene(panel, updateNode(panel.scene, nodeId, node => layers.updateTransformation(node, transformationId, item => ({ ...item, ...patch }))), [nodeId]);
}
export function removeTransformation(panel: SketchPanel, nodeId: string, transformationId: string): Patch {
  return commitScene(panel, updateNode(panel.scene, nodeId, node => layers.removeTransformation(node, transformationId)), [nodeId]);
}
export function moveTransformation(panel: SketchPanel, nodeId: string, transformationId: string, offset: number): Patch {
  return commitScene(panel, updateNode(panel.scene, nodeId, node => layers.moveTransformation(node, transformationId, offset)), [nodeId]);
}

/** Algorithm definitions are shared: editing one marks every node that uses it. */
export function editAlgorithm(panel: SketchPanel, algorithmId: string, patch: { name?: string; description?: string }): Patch {
  const users = sceneAlgorithmUsage(panel.scene).get(algorithmId)?.map(use => use.nodeId) || [];
  return setScene(panel, { ...panel.scene, algorithms: panel.scene.algorithms.map(item => item.id === algorithmId ? { ...item, ...patch } : item) }, users);
}

export function editMachineState(panel: SketchPanel, nodeId: string, stateId: string, patch: Partial<Pick<NodeState, "label" | "description">>): Patch {
  return setScene(panel, updateNode(panel.scene, nodeId, node => node.machine ? { ...node, machine: { ...node.machine, states: node.machine.states.map(state => state.id === stateId ? { ...state, ...patch } : state) } } : node), patch.description !== undefined ? [nodeId] : []);
}
/** Timing and labels are live in the host block; no regeneration needed. */
export function editTransition(panel: SketchPanel, nodeId: string, transitionId: string, patch: Partial<Pick<NodeTransition, "label" | "trigger" | "afterMs">>): Patch {
  return setScene(panel, updateNode(panel.scene, nodeId, node => node.machine ? { ...node, machine: { ...node.machine, transitions: node.machine.transitions.map(t => t.id === transitionId ? { ...t, ...patch } : t) } } : node));
}
export function removeMachine(panel: SketchPanel, nodeId: string): Patch {
  const editingStates = { ...panel.editingStates }; delete editingStates[nodeId];
  return { ...commitScene(panel, updateNode(panel.scene, nodeId, node => ({ ...node, machine: null })), [nodeId]), editingStates };
}
