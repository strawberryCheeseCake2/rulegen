import type { AIAlgorithm, AIArgValue, AIMachine, AINode, AITransformation, AIValue } from "./ai-schema";
import type { Algorithm, NodeMachine, Scene, SceneNode, SemanticTransformation, Value } from "./schema";
import { importAlgorithms, instantiate, normalizeCall } from "./algorithms";
import { clampNesting, clampRegion, fitCollections } from "./graph";
import { MAX_NESTING_DEPTH } from "./schema";
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

/** A complete scene from an extraction, composition or revision response. */
export function convertScene(output: { algorithms: AIAlgorithm[]; nodes: AINode[] }, library: Algorithm[] = []): Scene {
  const { library: algorithms, ids } = mergeAIAlgorithms(library, output.algorithms);
  // Deeper than allowed: the extra levels are flattened into their level-4 ancestor.
  const scene = fitCollections(clampNesting({ algorithms, nodes: breakCycles(convertNodes(output.nodes, algorithms, ids)) }, MAX_NESTING_DEPTH));
  // Unused definitions stay: they are alternatives the user can swap in elsewhere.
  return validateScene(scene);
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
