import type { Algorithm, AlgorithmCall, Scene, SceneNode, Constraint, Value } from "./schema";
import { MAX_SCENE_NODES, MAX_VALUE_DEPTH } from "./schema";
import { algorithmClosure, algorithmRefs, findAlgorithm, importAlgorithms, remapValue } from "./algorithms";
import { clampRegion, descendantIds, findNode, fitCollections, moveNodes, unionRegion, uniqueNodeId } from "./graph";
import { conformMachine } from "./machines";
import { appendParam, canTakeConstraint, findParam, findConstraint, mapParams, nodeParams, takeConstraint, updateParam } from "./constraints";
import { validateScene } from "./validate";
import { isAlgorithm, replaceAt, valueAt, valueDepth } from "./values";

/** What "Copy algorithm" puts on the studio clipboard: a call plus every definition it needs. */
export type AlgorithmClip = { call: AlgorithmCall; library: Algorithm[]; label: string };

export function copyAlgorithm(scene: Scene, call: AlgorithmCall): AlgorithmClip {
  return { call: structuredClone(call), library: algorithmClosure(scene.algorithms, algorithmRefs(call)), label: findAlgorithm(scene.algorithms, call.algorithmId)?.name || call.algorithmId };
}
/** A library definition copied with its default arguments. */
export function copyDefinition(scene: Scene, algorithmId: string, call: AlgorithmCall): AlgorithmClip {
  return copyAlgorithm(scene, { ...call, algorithmId });
}

const nodeValues = (node: SceneNode): Value[] => nodeParams(node).map(p => p.value);
const remapNode = (node: SceneNode, ids: Map<string, string>): SceneNode => mapParams(node, p => ({ ...p, value: remapValue(p.value, ids) }));

/** Paste a copied algorithm into any slot (param root or nested argument). Structural: base value only. */
export function pasteAlgorithm(scene: Scene, nodeId: string, paramId: string, path: string[], clip: AlgorithmClip): Scene {
  const node = findNode(scene, nodeId), param = node && findParam(node, paramId);
  if (!node || !param || !valueAt(param.value, path)) throw new Error("Could not find where to paste.");
  if (path.length + valueDepth(clip.call) > MAX_VALUE_DEPTH) throw new Error(`Algorithms can be nested at most ${MAX_VALUE_DEPTH} levels deep.`);
  const { library, ids } = importAlgorithms(scene.algorithms, clip.library);
  const call = remapValue(clip.call, ids);
  const value = replaceAt(param.value, path, () => call);
  const next = { ...scene, algorithms: library, nodes: scene.nodes.map(item => item.id !== nodeId ? item : conformMachine(updateParam(item, paramId, p => ({ ...p, value })))) };
  return validateScene(next);
}

/**
 * Copy a collection/object with all its members, algorithms and machines into
 * another scene, centred on `at` (normalized). Ids that already exist are renamed.
 */
/**
 * Copy a node with its members into another scene. Copies remember the node ids
 * their code module uses (`codeId`, `codeModule`), so they can run the source's
 * module without new code.
 */
export function transplantNodes(source: Scene, nodeId: string, target: Scene, at?: { x: number; y: number }): { scene: Scene; rootId: string; ids: Map<string, string> } {
  const root = findNode(source, nodeId);
  if (!root) throw new Error("Could not find the Collection or Object to move.");
  const subtree = [nodeId, ...descendantIds(source, nodeId)].map(id => findNode(source, id)!);
  if (target.nodes.length + subtree.length > MAX_SCENE_NODES) throw new Error(`A sketch can have at most ${MAX_SCENE_NODES} nodes.`);
  const refs = subtree.flatMap(node => nodeValues(node).flatMap(value => isAlgorithm(value) ? algorithmRefs(value) : []));
  const { library, ids } = importAlgorithms(target.algorithms, algorithmClosure(source.algorithms, refs));
  const nodeIds = new Map<string, string>();
  let scratch: Scene = { ...target, nodes: [...target.nodes] };
  for (const node of subtree) {
    const id = uniqueNodeId(scratch, node.id);
    nodeIds.set(node.id, id);
    scratch = { ...scratch, nodes: [...scratch.nodes, { ...node, id }] };
  }
  const copies = subtree.map(node => remapNode({ ...node, id: nodeIds.get(node.id)!, parentId: node.id === nodeId ? null : nodeIds.get(node.parentId!)!, codeId: node.codeId ?? node.id,
    ...(node.id === nodeId ? { codeModule: node.codeModule ?? node.id } : { codeModule: undefined }) }, ids));
  let scene: Scene = { algorithms: library, nodes: [...target.nodes, ...copies] };
  const rootId = nodeIds.get(nodeId)!;
  if (at) {
    const bounds = unionRegion(copies.map(node => node.region))!;
    scene = moveNodes(scene, [rootId], at.x - (bounds.x + bounds.w / 2), at.y - (bounds.y + bounds.h / 2));
  }
  scene = fitCollections({ ...scene, nodes: scene.nodes.map(node => ({ ...node, region: clampRegion(node.region) })) });
  return { scene: validateScene(scene), rootId, ids: nodeIds };
}

/** Move a node (with its members) so its bounds are centred on `at`. */
export function moveNodeTo(scene: Scene, nodeId: string, at: { x: number; y: number }): Scene {
  const ids = [nodeId, ...descendantIds(scene, nodeId)];
  const bounds = unionRegion(scene.nodes.filter(node => ids.includes(node.id)).map(node => node.region));
  return bounds ? moveNodes(scene, [nodeId], at.x - (bounds.x + bounds.w / 2), at.y - (bounds.y + bounds.h / 2)) : scene;
}

export const NODE_DRAG_TYPE = "application/x-rulegen-node";
export type NodeDragPayload = { sketchId: string; nodeId: string };
export function readNodeDrag(data: DataTransfer): NodeDragPayload | null {
  try { const value = JSON.parse(data.getData(NODE_DRAG_TYPE)); return typeof value?.sketchId === "string" && typeof value?.nodeId === "string" ? value : null; } catch { return null; }
}

/** Algorithm blocks travel between sockets, the palette and sketches as a clip. */
export const ALGORITHM_DRAG_TYPE = "application/x-rulegen-algorithm";
export function readAlgorithmDrag(data: DataTransfer): AlgorithmClip | null {
  try {
    const value = JSON.parse(data.getData(ALGORITHM_DRAG_TYPE));
    return value?.call?.type === "algorithm" && Array.isArray(value.library) && typeof value.label === "string" ? value : null;
  } catch { return null; }
}

/** What "Copy" on a constraint in Layers puts on the studio clipboard: the constraint plus every algorithm definition it needs. */
export type ConstraintClip = { constraint: Constraint; library: Algorithm[]; label: string };
export function copyConstraint(scene: Scene, nodeId: string, constraintId: string): ConstraintClip {
  const node = findNode(scene, nodeId), constraint = node && findConstraint(node, constraintId);
  if (!constraint) throw new Error("Could not find the constraint to copy.");
  const refs = constraint.params.flatMap(param => algorithmRefs(param.value));
  return { constraint: structuredClone(constraint), library: algorithmClosure(scene.algorithms, refs), label: constraint.property || constraint.id };
}
/**
 * Paste a copied constraint into a node (of this sketch or another): after `afterId` (none: at the end), its
 * algorithms brought into this library (renamed where an id means something else here), its ids made unique in the node.
 */
export function pasteConstraint(scene: Scene, nodeId: string, clip: ConstraintClip, afterId?: string | null): Scene {
  const node = findNode(scene, nodeId);
  if (!node) throw new Error("Could not find where to paste.");
  if (!canTakeConstraint(node, clip.constraint)) throw new Error(`“${node.name}” has no room for “${clip.label}”.`);
  const { library, ids } = importAlgorithms(scene.algorithms, clip.library);
  const copy = { ...clip.constraint, params: clip.constraint.params.map(param => ({ ...param, value: remapValue(param.value, ids) })) };
  const after = node.constraints.findIndex(item => item.id === afterId), before = after < 0 ? null : node.constraints[after + 1]?.id ?? null;
  const next = takeConstraint(node, copy, before);
  return validateScene({ ...scene, algorithms: library, nodes: scene.nodes.map(item => item.id === nodeId ? next : item) });
}

/**
 * Dropping a block on a constraint's "new socket" creates a param holding it
 * (without a target constraint: the last one with room, or a new one).
 */
export function addBlockParam(scene: Scene, nodeId: string, clip: AlgorithmClip, constraintId?: string | null): Scene {
  const node = findNode(scene, nodeId);
  if (!node) throw new Error("Could not find the node to attach the block to.");
  const { library, ids } = importAlgorithms(scene.algorithms, clip.library);
  const call = remapValue(clip.call, ids) as AlgorithmCall;
  const definition = findAlgorithm(library, call.algorithmId);
  const param = { id: call.algorithmId, label: (definition?.name || clip.label).slice(0, 80), effect: "spatial" as const, description: (definition?.description || "").slice(0, 600), value: call };
  const next = appendParam(node, param, constraintId, definition?.name || clip.label).node;
  return validateScene({ algorithms: library, nodes: scene.nodes.map(item => item.id === nodeId ? next : item) });
}
