import type { AIAlgorithm, AIArgValue, AIConstraint, AIMachine, AINode, AIValue } from "./ai-schema";
import type { Algorithm, Constraint, NodeMachine, Scene, SceneNode, Value } from "./schema";
import { importAlgorithms, instantiate, normalizeCall } from "./algorithms";
import { clampNesting, clampRegion, fitCollections } from "./graph";
import { MAX_NESTING_DEPTH } from "./schema";
import { conformMachine } from "./machines";
import { validateScene } from "./validate";
import { keptDrags, keptInputs } from "./constraints";

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

export function convertConstraint(constraint: AIConstraint, library: Algorithm[], ids: Ids): Constraint {
  const converted = { ...constraint, params: constraint.params.map(param => ({ ...param, value: normalizeCall(library, aiValue(param.value, ids)) })) };
  return { ...converted, inputs: keptInputs(converted), drags: keptDrags(converted) };
}
/**
 * A node's constraints, with constraint ids unique per node and param ids unique across it. `renames` gets each
 * constraint id the model gave and the id it got (the states follow it).
 */
export function convertConstraints(constraints: AIConstraint[], library: Algorithm[], ids: Ids, renames: Map<string, string> = new Map()): Constraint[] {
  const seenConstraints = new Set<string>(), seenParams = new Set<string>();
  const unique = (seen: Set<string>, id: string) => { let next = id, suffix = 2; while (seen.has(next)) next = `${id.slice(0, 70)}-${suffix++}`; seen.add(next); return next; };
  return constraints.map(constraint => {
    const converted = convertConstraint(constraint, library, ids), paramRenames = new Map<string, string>();
    const params = converted.params.map(param => { const id = unique(seenParams, param.id); if (!paramRenames.has(param.id)) paramRenames.set(param.id, id); return { ...param, id }; });
    const id = unique(seenConstraints, converted.id); if (!renames.has(constraint.id)) renames.set(constraint.id, id);
    // The pointer inputs and drags follow their params' new ids.
    return { ...converted, id, params, inputs: keptInputs({ ...converted, params }, paramRenames), drags: keptDrags({ ...converted, params }, paramRenames) };
  });
}
/** The machine with its states' constraint ids following the constraints' ids (unknown ones are dropped by conformMachine). */
export function convertMachine(machine: AIMachine, renames: ReadonlyMap<string, string> = new Map()): NodeMachine {
  return { ...machine, states: machine.states.map(state => ({ ...state, constraintIds: state.constraintIds.map(id => renames.get(id) ?? id) })) };
}

export function convertNodes(nodes: AINode[], library: Algorithm[], ids: Ids): SceneNode[] {
  const kinds = new Map(nodes.map(node => [node.id, node.kind]));
  return nodes.map(node => {
    const renames = new Map<string, string>(), constraints = convertConstraints(node.constraints, library, ids, renames);
    return conformMachine({
      id: node.id, kind: node.kind, name: node.name, description: node.description, primitive: node.primitive, visible: true,
      parentId: node.parentId && node.parentId !== node.id && kinds.get(node.parentId) === "collection" ? node.parentId : null,
      region: clampRegion(node.region), constraints, machine: node.machine ? convertMachine(node.machine, renames) : null,
    });
  });
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

/**
 * A node with an AI-made FSM: the new constraints it brought are added (ids made unique against the node's constraints
 * and params) and its states follow their ids.
 */
export function withMachine(node: SceneNode, output: { constraints: AIConstraint[]; machine: AIMachine }, library: Algorithm[], ids: Ids): SceneNode {
  const renames = new Map<string, string>(), takenConstraints = new Set(node.constraints.map(item => item.id)), takenParams = new Set(node.constraints.flatMap(item => item.params.map(param => param.id)));
  const unique = (taken: Set<string>, id: string) => { let next = id, suffix = 2; while (taken.has(next)) next = `${id.slice(0, 70)}-${suffix++}`; taken.add(next); return next; };
  const added = convertConstraints(output.constraints, library, ids).map((constraint, i) => {
    const paramRenames = new Map<string, string>();
    const params = constraint.params.map(param => { const id = unique(takenParams, param.id); paramRenames.set(param.id, id); return { ...param, id }; });
    const id = unique(takenConstraints, constraint.id); renames.set(output.constraints[i].id, id);
    return { ...constraint, id, params, inputs: keptInputs({ ...constraint, params }, paramRenames), drags: keptDrags({ ...constraint, params }, paramRenames) };
  });
  // Unknown constraint ids stay, so validateMachine rejects them (the model is asked again) instead of a state silently losing one.
  return { ...node, constraints: [...node.constraints, ...added], machine: convertMachine(output.machine, renames) };
}
