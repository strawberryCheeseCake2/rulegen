import type { AIAlgorithm, AIArgValue, AICompose, AIMachine, AINode, AITransformation, AIValue } from "./ai-schema";
import type { SemanticPen } from "../schema";
import type { Algorithm, NodeMachine, Scene, SceneNode, SemanticTransformation, Value } from "./schema";
import { importAlgorithms, instantiate, normalizeCall, remapValue } from "./algorithms";
import { clampNesting, clampRegion, fitCollections } from "./graph";
import { MAX_NESTING_DEPTH, MAX_NODE_PROPERTIES, MAX_TRANSFORMATIONS } from "./schema";
import { conformMachine } from "./machines";
import { validateScene } from "./validate";

// Model output → stored scene. References are expanded with defaults, ids that
// collide with different existing definitions are renamed, then everything is validated.

type Ids = Map<string, string>;
const mapId = (ids: Ids, id: string) => ids.get(id) || id;

function argValue(value: AIArgValue, ids: Ids): Value {
  return value.type === "algorithm-ref" ? { type: "algorithm", algorithmId: mapId(ids, value.algorithmId), args: [] } : value;
}
function aiValue(value: AIValue, ids: Ids): Value {
  return value.type === "algorithm" ? { type: "algorithm", algorithmId: mapId(ids, value.algorithmId), args: value.args.map(arg => ({ id: arg.id, value: argValue(arg.value, ids) })) } : value;
}

/** Merge model-provided definitions into an existing library. */
export function mergeAIAlgorithms(library: Algorithm[], incoming: AIAlgorithm[]) {
  const raw: Algorithm[] = incoming.map(algorithm => ({ ...algorithm, params: algorithm.params.map(param => ({ ...param, value: argValue(param.value, new Map()) })) }));
  // Definitions the model re-sent unchanged (by id and parameter ids) keep their identity.
  const fresh = raw.filter(algorithm => {
    const existing = library.find(item => item.id === algorithm.id);
    return !existing || existing.params.map(p => p.id).join() !== algorithm.params.map(p => p.id).join();
  });
  const { library: merged, ids } = importAlgorithms(library, fresh);
  for (const algorithm of raw) if (!ids.has(algorithm.id)) ids.set(algorithm.id, algorithm.id);
  const expanded = merged.map(algorithm => ({ ...algorithm, params: algorithm.params.map(param => ({ ...param, value: param.value.type === "algorithm" && !param.value.args.length ? instantiate(merged, param.value.algorithmId, 2, [algorithm.id]) : param.value })) }));
  return { library: expanded, ids };
}

export function convertTransformation(transformation: AITransformation, library: Algorithm[], ids: Ids): SemanticTransformation {
  return { ...transformation, properties: transformation.properties.map(property => ({ ...property, value: normalizeCall(library, aiValue(property.value, ids)) })) };
}
/** A node's stack, with transformation ids unique per node and property ids unique across it. */
export function convertTransformations(transformations: AITransformation[], library: Algorithm[], ids: Ids): SemanticTransformation[] {
  const seenLayers = new Set<string>(), seenProperties = new Set<string>();
  const unique = (seen: Set<string>, id: string) => { let next = id, suffix = 2; while (seen.has(next)) next = `${id.slice(0, 70)}-${suffix++}`; seen.add(next); return next; };
  return transformations.map(transformation => {
    const converted = convertTransformation(transformation, library, ids);
    return { ...converted, id: unique(seenLayers, converted.id), properties: converted.properties.map(property => ({ ...property, id: unique(seenProperties, property.id) })) };
  });
}
export function convertMachine(machine: AIMachine, library: Algorithm[], ids: Ids): NodeMachine {
  return { ...machine, states: machine.states.map(state => ({ ...state, values: state.values.map(item => ({ propertyId: item.propertyId, value: normalizeCall(library, aiValue(item.value, ids)) })) })) };
}

export function convertNodes(nodes: AINode[], library: Algorithm[], ids: Ids): SceneNode[] {
  const kinds = new Map(nodes.map(node => [node.id, node.kind]));
  return nodes.map(node => conformMachine({
    id: node.id, kind: node.kind, name: node.name, description: node.description, primitive: node.primitive, visible: true,
    parentId: node.parentId && node.parentId !== node.id && kinds.get(node.parentId) === "collection" ? node.parentId : null,
    region: clampRegion(node.region), transformations: convertTransformations(node.transformations, library, ids),
    machine: node.machine ? convertMachine(node.machine, library, ids) : null,
  }));
}

/** A complete scene from a model response. */
export function convertScene(output: { algorithms: AIAlgorithm[]; nodes: AINode[] }, library: Algorithm[] = []): Scene {
  const { library: algorithms, ids } = mergeAIAlgorithms(library, output.algorithms);
  return settle({ algorithms, nodes: convertNodes(output.nodes, algorithms, ids) });
}
// Deeper than allowed: the extra levels are flattened into their level-4 ancestor. Unused definitions stay (alternatives to swap in).
const settle = (scene: Scene) => validateScene(fitCollections(clampNesting({ ...scene, nodes: breakCycles(scene.nodes) }, MAX_NESTING_DEPTH)));

/**
 * A composed scene: each node takes the transformations of the pens it lists
 * (exact copies of what their minimal examples show, with their algorithms and an
 * `origin` pointing back), then its own. Ids that collide on a node are renamed.
 */
export function convertComposition(output: AICompose, pens: SemanticPen[]): Scene {
  let { library, ids } = mergeAIAlgorithms([], output.algorithms);
  // Machines are taken after the pens are in, so their states can set the pens' properties.
  const nodes = convertNodes(output.nodes.map(node => ({ ...node, machine: null })), library, ids).map((node, i) => {
    // The pens' ids win (machine states address their properties); the node's own ones are renamed on a collision.
    const taken = new Set<string>(), properties = new Set<string>();
    const unique = (seen: Set<string>, id: string) => { let next = id, suffix = 2; while (seen.has(next)) next = `${id.slice(0, 70)}-${suffix++}`; seen.add(next); return next; };
    const added: SemanticTransformation[] = [];
    for (const penId of [...new Set(output.nodes[i].pens)]) {
      const source = pens.find(pen => pen.id === penId)?.transformation;
      if (!source || added.length >= MAX_TRANSFORMATIONS || properties.size + source.transformation.properties.length > MAX_NODE_PROPERTIES) continue;
      const imported = importAlgorithms(library, source.library); library = imported.library;
      const transformation = source.transformation;
      added.push({ ...transformation, id: unique(taken, transformation.id), origin: { frameId: source.frameId, transformationId: transformation.id, label: transformation.label },
        properties: transformation.properties.map(property => ({ ...property, id: unique(properties, property.id), value: remapValue(property.value, imported.ids) })) });
    }
    const own = node.transformations.map(transformation => ({ ...transformation, id: unique(taken, transformation.id), properties: transformation.properties.map(property => ({ ...property, id: unique(properties, property.id) })) }));
    const machine = output.nodes[i].machine;
    return conformMachine({ ...node, transformations: [...added, ...own].slice(0, MAX_TRANSFORMATIONS), machine: machine ? convertMachine(machine, library, ids) : null });
  });
  return settle({ algorithms: library, nodes });
}
/**
 * A pen's transformation appended to one node exactly as its minimal example has it (its algorithms imported,
 * an `origin` pointing back); ids that collide on the node are renamed.
 */
export function addPenTransformation(scene: Scene, nodeId: string, pen: SemanticPen): Scene {
  const source = pen.transformation, node = scene.nodes.find(item => item.id === nodeId);
  if (!source || !node) throw new Error("펜의 transformation을 붙일 대상을 찾지 못했습니다.");
  if (node.transformations.length >= MAX_TRANSFORMATIONS) throw new Error("이 노드에는 더 이상 semantic transformation을 추가할 수 없습니다.");
  const taken = new Set(node.transformations.map(item => item.id)), properties = new Set(node.transformations.flatMap(item => item.properties.map(property => property.id)));
  if (properties.size + source.transformation.properties.length > MAX_NODE_PROPERTIES) throw new Error(`한 노드에는 property를 ${MAX_NODE_PROPERTIES}개까지 둘 수 있습니다.`);
  const unique = (seen: Set<string>, id: string) => { let next = id, suffix = 2; while (seen.has(next)) next = `${id.slice(0, 70)}-${suffix++}`; seen.add(next); return next; };
  const imported = importAlgorithms(scene.algorithms, source.library), transformation = source.transformation;
  const added: SemanticTransformation = { ...transformation, id: unique(taken, transformation.id), origin: { frameId: source.frameId, transformationId: transformation.id, label: transformation.label },
    properties: transformation.properties.map(property => ({ ...property, id: unique(properties, property.id), value: remapValue(property.value, imported.ids) })) };
  return validateScene({ ...scene, algorithms: imported.library, nodes: scene.nodes.map(item => item.id === nodeId ? conformMachine({ ...item, transformations: [...item.transformations, added] }) : item) });
}
function breakCycles(nodes: SceneNode[]): SceneNode[] {
  const byId = new Map(nodes.map(node => [node.id, node]));
  return nodes.map(node => {
    const seen = new Set([node.id]);
    let parent = node.parentId;
    while (parent) { if (seen.has(parent)) return { ...node, parentId: null }; seen.add(parent); parent = byId.get(parent)?.parentId ?? null; }
    return node;
  });
}
