import type { Algorithm, AlgorithmCall, Scene, SceneNode, Value } from "./schema";
import { MAX_SCENE_NODES, MAX_VALUE_DEPTH } from "./schema";
import { algorithmClosure, algorithmRefs, findAlgorithm, importAlgorithms, remapValue } from "./algorithms";
import { clampRegion, descendantIds, findNode, fitCollections, moveNodes, unionRegion, uniqueNodeId } from "./graph";
import { conformMachine } from "./machines";
import { appendProperty, findProperty, mapProperties, nodeProperties, updateProperty } from "./transformations";
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

const nodeValues = (node: SceneNode): Value[] => [...nodeProperties(node).map(p => p.value), ...(node.machine?.states.flatMap(s => s.values.map(v => v.value)) || [])];
function remapNode(node: SceneNode, ids: Map<string, string>): SceneNode {
  return { ...node,
    ...mapProperties(node, p => ({ ...p, value: remapValue(p.value, ids) })),
    machine: node.machine && { ...node.machine, states: node.machine.states.map(s => ({ ...s, values: s.values.map(v => ({ ...v, value: remapValue(v.value, ids) })) })) } };
}

/** Paste a copied algorithm into any slot (property root or nested argument). Structural: base value only. */
export function pasteAlgorithm(scene: Scene, nodeId: string, propertyId: string, path: string[], clip: AlgorithmClip): Scene {
  const node = findNode(scene, nodeId), property = node && findProperty(node, propertyId);
  if (!node || !property || !valueAt(property.value, path)) throw new Error("붙여넣을 위치를 찾지 못했습니다.");
  if (path.length + valueDepth(clip.call) > MAX_VALUE_DEPTH) throw new Error(`알고리즘은 최대 ${MAX_VALUE_DEPTH}단계까지 중첩할 수 있습니다.`);
  const { library, ids } = importAlgorithms(scene.algorithms, clip.library);
  const call = remapValue(clip.call, ids);
  const value = replaceAt(property.value, path, () => call);
  const next = { ...scene, algorithms: library, nodes: scene.nodes.map(item => item.id !== nodeId ? item : conformMachine(updateProperty(item, propertyId, p => ({ ...p, value })))) };
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
export const ALGORITHM_DRAG_TYPE = "application/x-rulegen-algorithm";
export function readAlgorithmDrag(data: DataTransfer): AlgorithmClip | null {
  try {
    const value = JSON.parse(data.getData(ALGORITHM_DRAG_TYPE));
    return value?.call?.type === "algorithm" && Array.isArray(value.library) && typeof value.label === "string" ? value : null;
  } catch { return null; }
}

/**
 * Dropping a block on a transformation's "new socket" creates a property holding it
 * (without a target transformation: the last one with room, or a new one).
 */
export function addBlockProperty(scene: Scene, nodeId: string, clip: AlgorithmClip, transformationId?: string | null): Scene {
  const node = findNode(scene, nodeId);
  if (!node) throw new Error("블록을 꽂을 노드를 찾지 못했습니다.");
  const { library, ids } = importAlgorithms(scene.algorithms, clip.library);
  const call = remapValue(clip.call, ids) as AlgorithmCall;
  const definition = findAlgorithm(library, call.algorithmId);
  const property = { id: call.algorithmId, label: (definition?.name || clip.label).slice(0, 80), effect: "spatial" as const, description: (definition?.description || "").slice(0, 600), value: call };
  const next = appendProperty(node, property, transformationId, definition?.name || clip.label).node;
  return validateScene({ algorithms: library, nodes: scene.nodes.map(item => item.id === nodeId ? next : item) });
}
