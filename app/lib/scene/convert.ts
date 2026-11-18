import type { AIConstraint, AIMachine, AINode } from "./ai-schema";
import type { Constraint, NodeMachine, Scene, SceneNode } from "./schema";
import { clampNesting, clampRegion, fitCollections } from "./graph";
import { MAX_NESTING_DEPTH } from "./schema";
import { conformMachine } from "./machines";
import { validateScene } from "./validate";
import { keptDrags, keptInputs } from "./constraints";

// Model output → stored scene: ids made unique, then everything is validated.

export function convertConstraint(constraint: AIConstraint): Constraint {
  return { ...constraint, inputs: keptInputs(constraint), drags: keptDrags(constraint) };
}
/**
 * A node's constraints, with constraint ids unique per node and param ids unique across it. `renames` gets each
 * constraint id the model gave and the id it got (the states follow it).
 */
export function convertConstraints(constraints: AIConstraint[], renames: Map<string, string> = new Map()): Constraint[] {
  const seenConstraints = new Set<string>(), seenParams = new Set<string>();
  const unique = (seen: Set<string>, id: string) => { let next = id, suffix = 2; while (seen.has(next)) next = `${id.slice(0, 70)}-${suffix++}`; seen.add(next); return next; };
  return constraints.map(constraint => {
    const converted = convertConstraint(constraint), paramRenames = new Map<string, string>();
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

export function convertNodes(nodes: AINode[]): SceneNode[] {
  const kinds = new Map(nodes.map(node => [node.id, node.kind]));
  return nodes.map(node => {
    const renames = new Map<string, string>(), constraints = convertConstraints(node.constraints, renames);
    return conformMachine({
      id: node.id, kind: node.kind, name: node.name, description: node.description, primitive: node.primitive, visible: true,
      parentId: node.parentId && node.parentId !== node.id && kinds.get(node.parentId) === "collection" ? node.parentId : null,
      region: clampRegion(node.region), constraints, machine: node.machine ? convertMachine(node.machine, renames) : null,
    });
  });
}

/** A complete scene from an extraction, composition or revision response. */
export function convertScene(output: { nodes: AINode[] }): Scene {
  // Deeper than allowed: the extra levels are flattened into their level-4 ancestor.
  const scene = fitCollections(clampNesting({ nodes: breakCycles(convertNodes(output.nodes)) }, MAX_NESTING_DEPTH));
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
export function withMachine(node: SceneNode, output: { constraints: AIConstraint[]; machine: AIMachine }): SceneNode {
  const renames = new Map<string, string>(), takenConstraints = new Set(node.constraints.map(item => item.id)), takenParams = new Set(node.constraints.flatMap(item => item.params.map(param => param.id)));
  const unique = (taken: Set<string>, id: string) => { let next = id, suffix = 2; while (taken.has(next)) next = `${id.slice(0, 70)}-${suffix++}`; taken.add(next); return next; };
  const added = convertConstraints(output.constraints).map((constraint, i) => {
    const paramRenames = new Map<string, string>();
    const params = constraint.params.map(param => { const id = unique(takenParams, param.id); paramRenames.set(param.id, id); return { ...param, id }; });
    const id = unique(takenConstraints, constraint.id); renames.set(output.constraints[i].id, id);
    return { ...constraint, id, params, inputs: keptInputs({ ...constraint, params }, paramRenames), drags: keptDrags({ ...constraint, params }, paramRenames) };
  });
  // Unknown constraint ids stay, so validateMachine rejects them (the model is asked again) instead of a state silently losing one.
  return { ...node, constraints: [...node.constraints, ...added], machine: convertMachine(output.machine, renames) };
}
